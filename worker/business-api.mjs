// ProfitHarbor AI Business checkout API (Ironcrest Workforce Operations).
// Standalone Worker: it does not handle Pro billing and does not process webhooks.
//
// Flow: verified ProfitHarbor account -> company created in Ironcrest -> Stripe
// customer mapped to that company -> Stripe Checkout. Access is granted only by
// the separate Business billing webhook after Stripe confirms a paid invoice.
//
// Required settings:
//   ENABLE_BUSINESS_CHECKOUT   "true" to open checkout (anything else: closed)
//   BUSINESS_STRIPE_MODE       "live" or "test"
//   BUSINESS_STRIPE_KEY        Stripe secret/restricted key for that mode (secret)
//   SUPABASE_SERVICE_ROLE_KEY  Supabase server key (secret)

const DEFAULTS = Object.freeze({
  project: 'https://nhiqbcevcdxfzvrprgck.supabase.co',
  publishableKey: 'sb_publishable_VwM3o7h2Jxq9_2WkkdE4kg_WKU6bvP6',
  origins: ['https://profitharborai.com', 'https://www.profitharborai.com'],
  ironcrestUrl: 'https://ironcrest.profitharborai.com/',
  stripeVersion: '2026-10-28.endive',
  // Same accounts and prices the Business billing webhook accepts.
  catalog: {
    live: { account: 'acct_1UWd63AQCOww3CbZ', prices: {
      month: { id: 'price_1UXk8pAQCOww3CbZm6PjdBil', amount: 12999 },
      year: { id: 'price_1UYO1JAQCOww3CbZAMWwOC7N', amount: 132590 } } },
    test: { account: 'acct_1UWd69AJcPWZlA8s', prices: {
      month: { id: 'price_1Uc5Z1AJcPWZlA8sEhP4K4Mb', amount: 12999 },
      year: { id: 'price_1Uc5Z2AJcPWZlA8s96n61KyL', amount: 132590 } } }
  },
  employeesIncluded: 20
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPEN_SUBSCRIPTION = new Set(['active', 'trialing', 'past_due', 'incomplete', 'unpaid', 'paused']);
const DATABASE_ERRORS = new Map([
  ['Account already belongs to a company', [409, 'employee_account', 'This account already belongs to a company as a team member. Use a separate account to buy Business.']],
  ['Existing company requires review', [409, 'company_review', 'Your existing company needs a quick review before checkout. Please contact support.']],
  ['Invalid company name', [400, 'invalid_company_name', 'Enter a company name of 1 to 120 characters.']],
  ['Billing customer already mapped', [409, 'billing_review', 'Billing for this account needs review. Please contact support.']]
]);

const REACTIVATION = [409, 'reactivation_review', 'This account had a Business subscription before. Please contact support to reactivate it.'];

class Stop extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

async function boundedJson(response, limit = 1000000) {
  const reader = response.body?.getReader();
  if (!reader) throw Error('Missing body');
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
  let size = 0, text = '';
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > limit) { await reader.cancel(); throw Error('Body too large'); }
    text += decoder.decode(part.value, { stream: true });
  }
  return JSON.parse(text + decoder.decode());
}

export function createBusinessApi(options = {}) {
  const config = { ...DEFAULTS, ...options };
  const fetcher = options.fetcher || fetch;
  const now = options.now || (() => Date.now());
  const origins = new Set(config.origins);

  function reply(body, status = 200, origin = '') {
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
    if (origins.has(origin)) { headers['Access-Control-Allow-Origin'] = origin; headers.Vary = 'Origin'; }
    return new Response(JSON.stringify(body), { status, headers });
  }

  function settings(env) {
    const mode = env.BUSINESS_STRIPE_MODE;
    if (mode !== 'live' && mode !== 'test') return null;
    const key = env.BUSINESS_STRIPE_KEY;
    if (typeof key !== 'string' || !new RegExp('^[sr]k_' + mode + '_[A-Za-z0-9]+$').test(key)) return null;
    if (!env.SUPABASE_SERVICE_ROLE_KEY) return null;
    return { mode, key, catalog: config.catalog[mode], open: env.ENABLE_BUSINESS_CHECKOUT === 'true'
      && env.BUSINESS_WEBHOOK_READY === 'true' && env.BUSINESS_CHECKOUT_ATTEMPTS_READY === 'true'
      && (mode === 'test' || options.productionApproved === true) };
  }

  function databaseHeaders(env) {
    const key = env.SUPABASE_SERVICE_ROLE_KEY;
    return { apikey: key, ...(key.startsWith('sb_secret_') ? {} : { Authorization: 'Bearer ' + key }) };
  }

  async function checkoutRpc(env, mode, userId, operation, data = {}) {
    const response = await fetcher(config.project + '/rest/v1/rpc/ironcrest_business_checkout', {
      method: 'POST', headers: { ...databaseHeaders(env), 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_mode: mode, p_user_id: userId, p_operation: operation, p_data: data }),
      redirect: 'manual', signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) {
      let message = '';
      try { message = (await boundedJson(response, 20000))?.message || ''; } catch { /* generic below */ }
      const known = DATABASE_ERRORS.get(message);
      if (known) throw new Stop(...known);
      throw Error('Checkout database unavailable');
    }
    const result = await boundedJson(response, 20000);
    if (!result || typeof result !== 'object' || result.mode !== mode || typeof result.hasCompany !== 'boolean') throw Error('Unexpected checkout state');
    return result;
  }

  async function proSubscriptionOpen(env, userId) {
    const response = await fetcher(config.project + '/rest/v1/ph_subscriptions_live?select=status,cancel_at_period_end&user_id=eq.' + encodeURIComponent(userId) + '&limit=1', {
      headers: databaseHeaders(env), redirect: 'manual', signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) throw Error('Membership lookup unavailable');
    const row = (await boundedJson(response, 20000))?.[0];
    return Boolean(row) && ['active', 'trialing', 'past_due'].includes(row.status) && row.cancel_at_period_end !== true;
  }

  async function attemptRpc(env, setup, user, operation, data) {
    const r = await fetcher(config.project + '/rest/v1/rpc/ironcrest_business_checkout_attempt', {
      method: 'POST', headers: { ...databaseHeaders(env), 'Content-Type': 'application/json' },
      body: JSON.stringify({p_mode:setup.mode,p_user_id:user.id,p_operation:operation,p_data:data}),
      redirect:'manual',signal:AbortSignal.timeout(10000)
    });
    if (!r.ok) throw Error('Checkout reservation unavailable');
    const a = await boundedJson(r,20000);
    if (!UUID.test(a?.attemptId || '') || !['month','year'].includes(a.interval) || !origins.has(a.origin)
      || !Number.isSafeInteger(a.expiresAt) || !/^cus_[A-Za-z0-9]+$/.test(a.customerId || '')
      || !UUID.test(a.organizationId || '') || (a.sessionId !== null && !/^cs_[A-Za-z0-9_]+$/.test(a.sessionId || '')))
      throw Error('Invalid checkout reservation');
    return a;
  }

  async function stripe(setup, path, params = null, idempotencyKey = null) {
    const response = await fetcher('https://api.stripe.com/v1' + path, {
      method: params ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer ' + setup.key, 'Stripe-Version': config.stripeVersion,
        ...(params ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
      ...(params ? { body: new URLSearchParams(params).toString() } : {}),
      redirect: 'manual', signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw Error('Stripe HTTP ' + response.status);
    const body = await boundedJson(response);
    if ('livemode' in body && body.livemode !== (setup.mode === 'live')) throw Error('Stripe mode mismatch');
    return body;
  }

  async function verifiedUser(request) {
    const header = request.headers.get('Authorization') || '';
    if (!/^Bearer [A-Za-z0-9._~-]{1,8192}$/.test(header)) return null;
    const response = await fetcher(config.project + '/auth/v1/user', {
      headers: { apikey: config.publishableKey, Authorization: header }, redirect: 'manual', signal: AbortSignal.timeout(8000)
    });
    if (response.status === 401 || response.status === 403) return null;
    if (!response.ok) throw Error('Authentication unavailable');
    const user = await boundedJson(response, 100000);
    return UUID.test(user?.id || '') && user.email_confirmed_at && typeof user.email === 'string' && user.email.length <= 254 ? user : null;
  }

  // Authenticated status checks verify saved credentials without starting a
  // purchase. This works for existing team members without changing eligibility.
  async function verifyCatalog(setup, intervals = ['month','year']) {
    const account = await stripe(setup, '/account');
    if (account?.id !== setup.catalog.account) throw Error('Stripe account mismatch');
    for (const interval of intervals) {
      const price = setup.catalog.prices[interval], receipt = await stripe(setup, '/prices/' + price.id);
      if (receipt.id !== price.id || receipt.livemode !== (setup.mode === 'live') || receipt.active !== true
        || receipt.currency !== 'usd' || receipt.unit_amount !== price.amount || receipt.recurring?.interval !== interval
        || receipt.recurring.interval_count !== 1) throw Error('Unexpected Business price');
    }
  }

  function publicStatus(setup, state) {
    const active = state.lifetimeBusiness === true || state.subscriptionActive === true;
    return {
      available: true, checkoutOpen: setup.open, mode: setup.mode,
      plan: active ? 'business' : 'none', active, lifetime: state.lifetimeBusiness === true,
      // Test-mode payments never unlock the live Ironcrest workspace.
      workspaceAccess: state.lifetimeBusiness === true || (setup.mode === 'live' && state.subscriptionActive === true),
      hasCompany: state.hasCompany, eligible: state.eligible === true,
      subscriptionStatus: state.subscriptionStatus || 'none',
      currentPeriodEnd: state.currentPeriodEnd || null, cancelAtPeriodEnd: state.cancelAtPeriodEnd === true,
      reviewRequired: state.reviewRequired === true, canManageBilling: Boolean(state.customerId) && Boolean(state.subscriptionStatus),
      employeesIncluded: config.employeesIncluded,
      prices: { month: setup.catalog.prices.month.amount, year: setup.catalog.prices.year.amount, currency: 'usd' },
      ironcrestUrl: config.ironcrestUrl
    };
  }

  async function checkout(request, env, setup, user, origin) {
    if (!setup.open) throw new Stop(503, 'checkout_closed', 'Business checkout is not open yet.');
    if (!/^application\/json(?:\s*;|$)/i.test((request.headers.get('Content-Type') || '').trim())) throw new Stop(415, 'json_required', 'JSON required.');
    let body;
    try { body = await boundedJson(request, 2048); } catch { throw new Stop(400, 'invalid_request', 'Invalid request.'); }
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !['interval', 'companyName'].includes(k))
      || !['month', 'year'].includes(body.interval) || ('companyName' in body && typeof body.companyName !== 'string'))
      throw new Stop(400, 'invalid_request', 'Choose monthly or annual billing.');
    const price = setup.catalog.prices[body.interval];

    let state = await checkoutRpc(env, setup.mode, user.id, 'status');
    if (state.lifetimeBusiness) throw new Stop(409, 'lifetime_business', 'Lifetime Business is already active on this account.');
    if (!state.eligible) throw new Stop(...DATABASE_ERRORS.get('Account already belongs to a company'));
    if (state.reviewRequired) throw new Stop(...DATABASE_ERRORS.get('Billing customer already mapped'));
    if (OPEN_SUBSCRIPTION.has(state.subscriptionStatus)) throw new Stop(409, 'existing_subscription', 'This account already has a Business subscription. Use Manage billing.');
    // The billing ledger pins one subscription per company; a replacement is not
    // accepted automatically, so never take payment for one here.
    if (state.subscriptionStatus) throw new Stop(...REACTIVATION);
    if (setup.mode === 'live' && await proSubscriptionOpen(env, user.id))
      throw new Stop(409, 'pro_subscription_active', 'Business includes Pro. Cancel your Pro subscription under Manage Pro Membership first (you keep Pro until the period ends), then choose Business.');

    const companyName = (body.companyName || '').trim();
    if (!state.hasCompany && (companyName.length < 1 || companyName.length > 120 || /[\u0000-\u001f\u007f]/.test(companyName)))
      throw new Stop(...DATABASE_ERRORS.get('Invalid company name'));

    // Verify the Stripe account and price before creating anything.
    await verifyCatalog(setup,[body.interval]);

    if (!state.hasCompany) state = await checkoutRpc(env, setup.mode, user.id, 'prepare', { companyName });
    if (!UUID.test(state.organizationId || '')) throw Error('Company not prepared');

    let customerId = state.customerId;
    if (!customerId) {
      // Deliberately no ph_user_id metadata: the Pro webhook must ignore Business billing.
      const customer = await stripe(setup, '/customers', { email: user.email,
        'metadata[ironcrest_owner_user_id]': user.id, 'metadata[ironcrest_organization_id]': state.organizationId },
        'ironcrest-business-customer:' + setup.mode + ':' + user.id);
      if (!/^cus_[A-Za-z0-9]+$/.test(customer?.id || '')) throw Error('Invalid customer receipt');
      state = await checkoutRpc(env, setup.mode, user.id, 'customer', { customerId: customer.id });
      customerId = state.customerId;
    }
    if (!/^cus_[A-Za-z0-9]+$/.test(customerId || '')) throw Error('Customer not mapped');

    // A payment may have completed moments ago, before the webhook recorded it.
    const existing = await stripe(setup, '/subscriptions?' + new URLSearchParams({ customer: customerId, status: 'all', limit: '20' }));
    if (!Array.isArray(existing?.data) || existing.has_more !== false) throw Error('Subscription list unavailable');
    if (existing.data.some(s => OPEN_SUBSCRIPTION.has(s?.status)))
      throw new Stop(409, 'existing_subscription', 'A Business subscription already exists for this account. If you just paid, give it a minute and refresh.');
    if (existing.data.length) throw new Stop(...REACTIVATION);

    let attempt = await attemptRpc(env,setup,user,'reserve',{interval:body.interval,origin});
    if (attempt.customerId !== customerId || attempt.organizationId !== state.organizationId) throw Error('Checkout mapping mismatch');
    let session;
    if (attempt.sessionId) {
      session = await stripe(setup,'/checkout/sessions/'+attempt.sessionId);
      if (session.id !== attempt.sessionId || session.customer !== customerId || session.mode !== 'subscription'
        || session.livemode !== (setup.mode === 'live')) throw Error('Invalid checkout receipt');
      if (session.status === 'expired') {
        attempt = await attemptRpc(env,setup,user,'expired',{attemptId:attempt.attemptId,sessionId:attempt.sessionId,interval:body.interval,origin});
        session = null;
      } else if (session.status !== 'open') throw new Stop(409,'payment_pending','Checkout has already completed. Refresh billing status before trying again.');
    }
    if (attempt.interval !== body.interval) throw new Stop(409,'checkout_in_progress','A checkout for the other billing interval is already open. Complete or let that checkout expire before changing plans.');
    // Persisted parameters and a single reservation survive retries, clock changes,
    // monthly/annual races and uncertain Stripe responses across Worker instances.
    if (!session && attempt.expiresAt < Math.floor(now()/1000)+1800)
      throw new Stop(409,'checkout_review','A previous checkout needs review before another payment can be started. Please contact support.');
    if (!session) session = await stripe(setup, '/checkout/sessions', {
      mode: 'subscription', customer: customerId, 'line_items[0][price]': price.id, 'line_items[0][quantity]': '1',
      client_reference_id: user.id, 'metadata[ironcrest_organization_id]': state.organizationId,
      'subscription_data[metadata][ironcrest_organization_id]': state.organizationId,
      success_url: attempt.origin + '/?business=success', cancel_url: attempt.origin + '/?business=cancelled',
      expires_at: String(attempt.expiresAt)
    }, 'ironcrest-business-checkout:' + setup.mode + ':' + attempt.attemptId);
    let url;
    try { url = new URL(session.url); } catch { throw Error('Invalid checkout receipt'); }
    if (!/^cs_[A-Za-z0-9_]+$/.test(session.id || '') || session.livemode !== (setup.mode === 'live')
      || session.status !== 'open' || session.expires_at !== attempt.expiresAt
      || session.mode !== 'subscription' || session.customer !== customerId || url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com' || url.username || url.password || url.port)
      throw Error('Invalid checkout receipt');
    await attemptRpc(env,setup,user,'record',{attemptId:attempt.attemptId,sessionId:session.id});
    return reply({ url: url.href }, 200, origin);
  }

  async function portal(env, setup, user, origin) {
    const state = await checkoutRpc(env, setup.mode, user.id, 'status');
    if (!/^cus_[A-Za-z0-9]+$/.test(state.customerId || '') || !state.subscriptionStatus) throw new Stop(404, 'no_billing', 'No Business billing found for this account.');
    if ((await stripe(setup,'/account'))?.id !== setup.catalog.account) throw Error('Stripe account mismatch');
    const session = await stripe(setup, '/billing_portal/sessions', { customer: state.customerId, return_url: origin + '/' });
    let url;
    try { url = new URL(session.url); } catch { throw Error('Invalid portal receipt'); }
    if (url.protocol !== 'https:' || url.hostname !== 'billing.stripe.com' || url.username || url.password || url.port) throw Error('Invalid portal receipt');
    return reply({ url: url.href }, 200, origin);
  }

  return { async fetch(request, env) {
    const url = new URL(request.url), origin = request.headers.get('Origin') || '';
    const setup = settings(env);
    if (url.pathname === '/health' && request.method === 'GET')
      return reply({ ok: true, service: 'profitharbor-business-api', configured: Boolean(setup), mode: setup?.mode || 'unconfigured', checkoutOpen: Boolean(setup?.open) }, 200, origin);
    const routes = { '/api/business/status': 'GET', '/api/business/checkout': 'POST', '/api/business/portal': 'POST' };
    if (!(url.pathname in routes)) return reply({ error: 'Not found' }, 404, origin);
    if (!origins.has(origin)) return reply({ error: 'Origin not allowed' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '600', Vary: 'Origin' } });
    if (request.method !== routes[url.pathname]) return reply({ error: 'Method not allowed' }, 405, origin);
    if (url.search) return reply({ error: 'Query parameters not supported' }, 400, origin);
    if (!setup) return url.pathname === '/api/business/status'
      ? reply({ available: false, checkoutOpen: false }, 200, origin) : reply({ error: 'Business billing is not available yet.', code: 'unavailable' }, 503, origin);
    try {
      const user = await verifiedUser(request);
      if (!user) return reply({ error: 'Sign in with a verified email first.', code: 'sign_in_required' }, 401, origin);
      if (url.pathname === '/api/business/status') {
        const state = await checkoutRpc(env, setup.mode, user.id, 'status');
        const verify = setup.mode === 'test' && setup.open || options.verifyConfiguration === true;
        if (verify) await verifyCatalog(setup);
        return reply({...publicStatus(setup,state),...(verify?{billingConnectionVerified:true}:{})},200,origin);
      }
      if (url.pathname === '/api/business/portal') return await portal(env, setup, user, origin);
      return await checkout(request, env, setup, user, origin);
    } catch (error) {
      if (error instanceof Stop) return reply({ error: error.message, code: error.code }, error.status, origin);
      console.warn('Business API failure', String(error?.message || 'error').slice(0, 80));
      return reply({ error: 'Business billing is temporarily unavailable. Refresh billing status before trying again.', code: 'unavailable' }, 503, origin);
    }
  } };
}

export default createBusinessApi();

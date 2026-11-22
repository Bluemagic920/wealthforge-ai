// Public compatibility address only. It holds no billing credentials and
// forwards only the existing Business routes to the same owner's live service.
export function createBusinessApiProxy({fetcher=null}={}){
 const host='https://profitharbor-ai-live-api.bluemagic920.workers.dev';
 const paths=new Set(['/health','/api/business/status','/api/business/checkout','/api/business/portal']);
 return {async fetch(request,env={}){
  const original=new URL(request.url);
  if(!paths.has(original.pathname))return new Response('Not found',{status:404});
  const send=fetcher||(typeof env.BUSINESS_BACKEND?.fetch==='function'?req=>env.BUSINESS_BACKEND.fetch(req):null);
  if(!send)return Response.json({available:false,configured:false,checkoutOpen:false},{status:503,headers:{'Cache-Control':'no-store'}});
  const target=new URL(original.pathname==='/health'?'/api/business/health':original.pathname,host);
  target.search=original.search;
  const headers=new Headers();
  for(const name of ['Origin','Authorization','Content-Type','Access-Control-Request-Method','Access-Control-Request-Headers']){
   const value=request.headers.get(name);if(value!==null)headers.set(name,value);
  }
  /** @type {RequestInit & {duplex?: 'half'}} */
  const init={method:request.method,headers,
    ...(!['GET','HEAD'].includes(request.method)?{body:request.body,duplex:'half'}:{}),redirect:'manual'};
  return send(new Request(target,init));
 }};
}
export default createBusinessApiProxy();

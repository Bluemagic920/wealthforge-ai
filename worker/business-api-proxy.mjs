// Public compatibility address only. It holds no billing credentials and
// forwards only the existing Business routes to the same owner's live service.
export function createBusinessApiProxy({fetcher=fetch}={}){
 const host='https://profitharbor-ai-live-api.bluemagic920.workers.dev';
 const paths=new Set(['/health','/api/business/status','/api/business/checkout','/api/business/portal']);
 return {async fetch(request){
  const original=new URL(request.url);
  if(!paths.has(original.pathname))return new Response('Not found',{status:404});
  const target=new URL(original.pathname==='/health'?'/api/business/health':original.pathname,host);
  target.search=original.search;
  const headers=new Headers();
  for(const name of ['Origin','Authorization','Content-Type','Access-Control-Request-Method','Access-Control-Request-Headers']){
   const value=request.headers.get(name);if(value!==null)headers.set(name,value);
  }
  /** @type {RequestInit & {duplex?: 'half'}} */
  const init={method:request.method,headers,
    ...(!['GET','HEAD'].includes(request.method)?{body:request.body,duplex:'half'}:{}),redirect:'manual'};
  return fetcher(new Request(target,init));
 }};
}
export default createBusinessApiProxy();

const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {build:proBuild}=require('./build-business-pro-access.cjs');
const root=path.join(__dirname,'..');
function moduleFactory(file,name,{imports=false}={}){
 let s=fs.readFileSync(path.join(root,file),'utf8').replace(/\r\n/g,'\n');
 if(file.endsWith('business-webhook-vendored.mjs')&&crypto.createHash('sha256').update(s).digest('hex')!=='279413a7f698173871f2fc83f2b14738eac33984ee6fb2cdf75672f314015ef2')throw Error('Reviewed webhook bundle changed');
 if(imports)s=s.replace(/^import .*;\n/gm,'');
 s=s.replace(/^export default [^\n]*;\n?/gm,'').replace(/^export (?=(?:async )?function|const )/gm,'');
 if(/^import |^export /m.test(s))throw Error('Unexpected module syntax: '+file);
 return '(()=>{\n'+s+'\nreturn '+name+';\n})()';
}
function build({productionApproved=false}={}){
 const pro=proBuild(fs.readFileSync(path.join(root,'tests/helpers/pro-live-baseline.mjs'),'utf8'));
 const marker='export default {';if(pro.split(marker).length!==2)throw Error('Unexpected Pro export');
 return '// Generated Business integration. Existing Pro credentials remain in their original Worker.\n'
  +'const createBusinessApi='+moduleFactory('worker/business-api.mjs','createBusinessApi')+';\n'
  +'const createBusinessBillingWorker='+moduleFactory('worker/business-webhook-vendored.mjs','createBusinessBillingWorker')+';\n'
  +'const createSharedBusinessWorker='+moduleFactory('worker/business-shared-runtime.mjs','createSharedBusinessWorker',{imports:true})+';\n'
  +pro.replace(marker,'const profitHarborCore = {')+'\nexport default createSharedBusinessWorker({core:profitHarborCore,sourceApproved:'+JSON.stringify(productionApproved===true)+'});\n';
}
module.exports={build};
if(require.main===module){const args=process.argv.slice(2),approved=args.includes('--production-approved'),paths=args.filter(x=>!x.startsWith('--'));
 if(paths.length!==1||args.some(x=>x.startsWith('--')&&x!=='--production-approved'))throw Error('Supply one output path and optional --production-approved');
 const code=build({productionApproved:approved});fs.writeFileSync(paths[0],code);console.log(JSON.stringify({productionApproved:approved,sha256:crypto.createHash('sha256').update(code).digest('hex')}));}

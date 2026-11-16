const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),os=require('node:os');
let checked=0;function check(file){const r=cp.spawnSync(process.execPath,['--check',file],{encoding:'utf8',windowsHide:true});if(r.status!==0)throw Error(file+'\n'+r.stderr);checked++;}
for(const dir of ['.','worker','tools','tests','tests/helpers'])for(const file of fs.readdirSync(dir))if(/\.(mjs|cjs|js)$/.test(file))check(path.join(dir,file));
const html=fs.readFileSync('index.html','utf8');let i=0;for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){if(/\bsrc\s*=/.test(m[1])||!m[2].trim())continue;if(/type=["']application\/ld\+json["']/.test(m[1])){JSON.parse(m[2]);continue;}const p=path.join(os.tmpdir(),'ph-inline-'+process.pid+'-'+i+++'.js');try{fs.writeFileSync(p,m[2]);check(p);}finally{fs.unlinkSync(p);}}
if(!html.includes('<script src="ph-leads-client.js"></script><script id="ph-lead-wizard-v3" src="lead-wizard.js"></script>'))throw Error('Shared client must load before campaign controls');
console.log(checked+' scripts passed syntax checks');

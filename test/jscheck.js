const fs=require("fs");
const vm=require("vm");
const html=fs.readFileSync("/mnt/c/Users/enddooa/madrid-kids/index.html","utf8");
const re=/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
let m,i=0,ok=true;
while((m=re.exec(html))){
  i++;
  const code=m[1];
  try{
    new vm.Script(code,{filename:`block${i}.js`});
    console.log(`block ${i}: OK (${code.length} chars)`);
  }catch(e){
    ok=false;
    console.log(`block ${i}: SYNTAX ERROR -> ${e.message}`);
  }
}
console.log(ok?"ALL BLOCKS OK":"HAS ERRORS");
process.exit(ok?0:1);

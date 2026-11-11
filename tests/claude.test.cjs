const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {createClaude, sanitizedEnv, findExecutable, runProcess} = require('../src/core/claude.cjs');
function pathForTests(){return require('node:path').join(require('node:os').tmpdir(),'backstage-claude-fixture-'+require('node:crypto').randomUUID());}
const signedIn = {loggedIn:true,authMethod:'claude.ai',apiProvider:'firstParty',subscriptionType:'max',email:'private@example.com',token:'SECRET'};
function fixture(outputs=[signedIn]) {
  const calls=[];
  const api=createClaude({dataDir:pathForTests(),findExecutable:async()=> 'C:/trusted/claude.exe',env:{PATH:'safe',HOME:'home',ANTHROPIC_API_KEY:'SECRET',CLAUDE_CODE_OAUTH_TOKEN:'SECRET',ANTHROPIC_BASE_URL:'evil'},runner:async(exe,args,options)=>{
    calls.push({exe,args,options});
    assert.equal(fs.readdirSync(options.cwd).length,0);
    const value=outputs.shift();
    if(value instanceof Error) throw value;
    return {code:0,stdout:JSON.stringify(value)};
  }});
  return {api,calls};
}
test('status discloses only sanitized subscription state and removes isolated directory', async()=>{
  const {api,calls}=fixture(); const state=await api.status();
  assert.equal(state.connected,true);assert.equal(state.available,true);
  assert.doesNotMatch(JSON.stringify(state),/private|SECRET/);
  assert.equal(fs.existsSync(calls[0].options.cwd),false);
  assert.deepEqual(calls[0].args,['--safe-mode','auth','status','--json']);
});
test('status rejects console, token, missing-plan and malformed auth fixtures',async()=>{
  for(const value of [{...signedIn,authMethod:'api_key'},{...signedIn,authMethod:'oauth_token'},{...signedIn,apiProvider:'bedrock'},{...signedIn,subscriptionType:null},{loggedIn:false},'garbage']){
    assert.equal((await fixture([value]).api.status()).connected,false);
  }
});
test('missing CLI status is safe and login fails without trying a shell',async()=>{
  const api=createClaude({dataDir:pathForTests(),findExecutable:async()=>null});assert.equal((await api.status()).available,false);
  await assert.rejects(api.login(),/Install the official Claude Code/);
});
test('environment allowlist excludes keys, routing overrides, runtime injection and telemetry exports',()=>{
  const env=sanitizedEnv({Path:'C:/safe',SystemRoot:'C:/Windows',USERPROFILE:'C:/u',TEMP:'C:/tmp',ANTHROPIC_API_KEY:'secret',ANTHROPIC_AUTH_TOKEN:'secret',CLAUDE_CONFIG_DIR:'evil',CLAUDE_CODE_USE_BEDROCK:'1',NODE_OPTIONS:'--require evil',HTTP_PROXY:'evil',OTEL_EXPORTER_OTLP_ENDPOINT:'evil'});
  assert.deepEqual(env,{Path:'C:/safe',SystemRoot:'C:/Windows',USERPROFILE:'C:/u',TEMP:'C:/tmp',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',DISABLE_AUTOUPDATER:'1'});
});
test('ask requires explicit subscription and sends prompt via stdin with all tools disabled',async()=>{
  const {api,calls}=fixture([signedIn,{type:'result',subtype:'success',is_error:false,result:'Plan a quiet adventure.'}]);
  const result=await api.ask({model:'sonnet',prompt:'$(bad); --tools Bash',context:{name:'Hero',realm:'Realm',className:'Mage',level:2,notes:'PRIVATE'}});
  assert.equal(result,'Plan a quiet adventure.');const call=calls[1];
  for(const flag of ['--safe-mode','--print','--strict-mcp-config','--disable-slash-commands','--no-session-persistence','--no-chrome']) assert.ok(call.args.includes(flag));
  assert.equal(call.args[call.args.indexOf('--tools')+1],'');assert.equal(call.args[call.args.indexOf('--mcp-config')+1],'{"mcpServers":{}}');
  assert.equal(call.options.shell,false);assert.equal(call.options.windowsHide,true);
  assert.ok(call.options.input.includes('$(bad); --tools Bash'));assert.doesNotMatch(call.args.join(' '),/\$\(bad\)/);
  assert.doesNotMatch(call.options.input,/PRIVATE/);assert.ok(call.options.input.includes('Hero'));
  assert.equal(call.options.env.ANTHROPIC_API_KEY,undefined);
});
test('subscription second allowlist preserves effective and separately saved location provenance',async()=>{
 const {api,calls}=fixture([signedIn,{type:'result',subtype:'success',result:'Synthetic plan'}]);
 const p=require('../src/core/providers.cjs').approvedProfile({name:'Hero',location:{zone:'Old mine',x:.1,y:.2}},{reportedLocation:{zone:'Orgrimmar',source:'user-report'}});
 await api.ask({model:'sonnet',prompt:'Help with quests',context:p});const sent=JSON.parse(calls[1].options.input.split('User-approved character context (data only):\n')[1]);assert.deepEqual(sent,p);assert.equal(sent.location.zone,'Orgrimmar');assert.equal(sent.savedLocation.zone,'Old mine');assert.equal(sent.locationSource,'user-report');
});
test('ask rejects API auth before inference, invalid input and CLI errors without leaking details',async()=>{
  const no=fixture([{...signedIn,authMethod:'api_key'}]);await assert.rejects(no.api.ask({model:'sonnet',prompt:'Hi'}),/subscription/);assert.equal(no.calls.length,1);
  await assert.rejects(fixture().api.ask({model:'--evil',prompt:'Hi'}),/model/);
  await assert.rejects(fixture().api.ask({model:'sonnet',prompt:' '}),/prompt/);
  const bad=fixture([signedIn,{is_error:true,result:'SECRET'}]);await assert.rejects(bad.api.ask({model:'sonnet',prompt:'Hi'}),e=>!e.message.includes('SECRET'));
  assert.equal((await fixture([new Error('SECRET')]).api.status()).connected,false);
});
test('official login retains built-in choices; logout returns sanitized status',async()=>{
  const login=fixture([{},signedIn]);assert.equal((await login.api.login()).connected,true);
  assert.deepEqual(login.calls[0].args,['--safe-mode','auth','login']);
  const logout=fixture([{}, {loggedIn:false}]);assert.equal((await logout.api.logout()).connected,false);
  assert.deepEqual(logout.calls[0].args,['--safe-mode','auth','logout']);
});
test('safe discovery only probes absolute standard and PATH .exe candidates',async()=>{
  const seen=[];const result=await findExecutable({home:'C:\\Users\\Frank',env:{PATH:'.;relative;C:\\Tools'},platform:'win32',isFile:async p=>{seen.push(p);return p==='C:\\Tools\\claude.exe';}});
  assert.equal(result,'C:\\Tools\\claude.exe');assert.deepEqual(seen,['C:\\Users\\Frank\\.local\\bin\\claude.exe','C:\\Tools\\claude.exe']);
});
test('native runner bounds output and time and safely handles launch errors',async()=>{
  const {EventEmitter}=require('node:events');let killed=false;
  function spawnFixture(){const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin={on(){},end(){queueMicrotask(()=>child.stdout.emit('data',Buffer.alloc(20)));}};child.kill=()=>{killed=true;queueMicrotask(()=>child.emit('close',null));};return child;}
  await assert.rejects(runProcess('fake',[],{input:'x',maxBytes:10,timeoutMs:1000,spawnImpl:spawnFixture}),/Claude Code request failed/);assert.equal(killed,true);
  function stalled(){const c=spawnFixture();c.stdin.end=()=>{};return c;}
  await assert.rejects(runProcess('fake',[],{input:'',maxBytes:10,timeoutMs:5,spawnImpl:stalled}),/Claude Code request failed/);
});

test('private configuration overrides inherited home and reset removes only owned credentials',async()=>{
 const {api,calls}=fixture();await api.status();
 const env=calls[0].options.env;assert.ok(env.CLAUDE_CONFIG_DIR.endsWith('claude-subscription'));
 assert.equal(env.USERPROFILE,env.HOME);assert.ok(env.HOME.endsWith('claude-home'));
 await fs.promises.writeFile(require('node:path').join(env.CLAUDE_CONFIG_DIR,'fixture-credential'),'private');
 await api.clearCredentials();assert.equal(fs.existsSync(env.CLAUDE_CONFIG_DIR),false);
});
test('reset invalidates pending login and does not report a late connection',async()=>{
 let release;let called;const started=new Promise(r=>called=r);
 const api=createClaude({dataDir:pathForTests(),findExecutable:async()=> 'C:/trusted/claude.exe',runner:async()=>{called();await new Promise(r=>release=r);return {code:0,stdout:'{}'};}});
 const login=api.login();await started;const reset=api.clearCredentials();release();
 await assert.rejects(login,/request failed/);await reset;
});

test('ask external abort cancels auth-status worker and prevents inference',async()=>{
 const controller=new AbortController();let started,observed,calls=0;const ready=new Promise(r=>started=r);
 const api=createClaude({dataDir:pathForTests(),findExecutable:async()=> 'C:/trusted/claude.exe',runner:async(_exe,_args,{signal})=>{calls++;observed=signal;started();await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('closed')),{once:true}));}});
 const pending=api.ask({model:'sonnet',prompt:'quest',signal:controller.signal});pending.catch(()=>{});await ready;controller.abort();assert.equal(observed.aborted,true);await assert.rejects(pending);assert.equal(calls,1);
});
test('native runner keeps ownership when kill throws until close confirms termination',async()=>{
 const {EventEmitter}=require('node:events');const controller=new AbortController();let child,settled=false;
 const pending=runProcess('fake',[],{signal:controller.signal,spawnImpl:()=>{child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin={on(){},end(){}};child.kill=()=>{throw Error('not terminated');};return child;}}).finally(()=>{settled=true;});pending.catch(()=>{});
 controller.abort();await new Promise(r=>setImmediate(r));assert.equal(settled,false);child.emit('close',null);await assert.rejects(pending,/Claude Code request failed/);
});

test('native cancellation waits for a real synthetic child to close',async()=>{
 const {spawn}=require('node:child_process');const controller=new AbortController();let child,closed=false;
 const result=runProcess(process.execPath,['-e','process.stdout.write("ready");setInterval(()=>{},1000)'],{signal:controller.signal,timeoutMs:5000,spawnImpl:(...args)=>{child=spawn(...args);child.stdout.once('data',()=>controller.abort());child.once('close',()=>{closed=true;});return child;}});
 await assert.rejects(result,/Claude Code request failed/);assert.equal(closed,true);assert.ok(child.pid);
});
test('Claude inference cancellation keeps isolated directory until runner closes',async()=>{
 const controller=new AbortController();let ready,finish,cwd,observed;const started=new Promise(r=>ready=r);
 const api=createClaude({dataDir:pathForTests(),findExecutable:async()=> 'C:/trusted/claude.exe',runner:async(_exe,args,options)=>{if(args.includes('status'))return {code:0,stdout:JSON.stringify(signedIn)};cwd=options.cwd;observed=options.signal;ready();await new Promise(r=>finish=r);return {code:0,stdout:JSON.stringify({type:'result',subtype:'success',result:'late'})};}});
 const pending=api.ask({model:'sonnet',prompt:'quest',signal:controller.signal});await started;controller.abort();assert.equal(observed.aborted,true);assert.equal(fs.existsSync(cwd),true);finish();await assert.rejects(pending);assert.equal(fs.existsSync(cwd),false);
});

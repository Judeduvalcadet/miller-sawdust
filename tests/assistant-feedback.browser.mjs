// Run with PLAYWRIGHT_MODULE pointing to an installed Playwright index.mjs.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import assert from 'node:assert/strict';
const browser = await chromium.launch({headless:true, executablePath:process.env.PLAYWRIGHT_EXECUTABLE || undefined});
const page = await browser.newPage({viewport:{width:1280,height:720}});
let savedInvoice = null;
const sentRequests = [];
const errors=[]; page.on('pageerror',e=>errors.push(e.message));
const date=new Date().toLocaleDateString('en-CA');
const customer={id:'10000000-0000-4000-8000-000000000001',name:'Test delivery',street_address:'Original street',active:true};
const item={id:'10000000-0000-4000-8000-000000000002',name:'Test load',unit_price:100,active:true,is_load_item:true};
const job={id:'10000000-0000-4000-8000-000000000003',job_type:'delivery',truck_type:'straight_truck',scheduled_date:date,status:'pending',quantity:1,customer_id:customer.id,location_name:customer.name,address:'Job address',loads:[{load_number:1,item_id:item.id,truck_type:'straight_truck',load_configuration:'Test load',yards_collected:20}]};
const drivers=Array.from({length:35},(_,i)=>({id:`driver-${i}`,name:`Driver ${String(i).padStart(2,'0')}`,active:true,role:'driver',driver_type:'delivery'}));
await page.addInitScript(()=>{ const jwt=`e30.${btoa(JSON.stringify({exp:Math.floor(Date.now()/1000)+86400,amr:'password',app_role:'admin',sub:'test'}))}.test`;localStorage.setItem('miller_jwt',jwt);localStorage.setItem('miller_driver_role','admin');localStorage.setItem('miller_driver_name','Test office');localStorage.setItem('miller_driver_id','test'); });
await page.route('**/rest/v1/**',async route=>{
 const name=new URL(route.request().url()).pathname.split('/').pop();
 if (name === 'customers' && route.request().method() === 'PATCH') { Object.assign(customer, route.request().postDataJSON()); await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(customer)}); return; }
 if (name === 'jobs' && route.request().method() === 'PATCH') { Object.assign(job, route.request().postDataJSON()); await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(job)}); return; }
 if(name === 'next_invoice_number') {await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify('TEST-100')});return;}
 if(name === 'invoices' && ['POST','PATCH'].includes(route.request().method())) {savedInvoice={...savedInvoice,...route.request().postDataJSON(),id:job.id};await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(savedInvoice)});return;}
 const data=({jobs:[job],customers:[customer,{id:'payer',name:'Billing person',street_address:'Billing street',active:true}],drivers,items:[item],customer_item_prices:[],invoices:savedInvoice ? [savedInvoice] : [],settings:[],pickup_locations:[],drop_off_locations:[],job_events:[]})[name] || [];
 await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
});
await page.route('**/functions/v1/**',async r=> {
 if(r.request().url().endsWith('/send-invoice')) {
  sentRequests.push(r.request().postDataJSON());
  await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(sentRequests.length === 1 ? {error:'Temporary test failure'} : {message:{status:'sent'}})});return;
 }
 await r.fulfill({status:200,contentType:'application/json',body:'{}'});
});

let feedback=[];
await page.route('**/functions/v1/assistant-dev',async route=>{
 const data=route.request().postDataJSON();
 if(data.action==='feedback'){feedback.push(data);await route.fulfill({json:{saved:true}});return;}
 if(data.action==='reviews'){await route.fulfill({json:{feedback:[],rules:[],runs:[]}});return;}
 if(data.action==='list'){await route.fulfill({json:{conversations:[]}});return;}
 await route.fulfill({contentType:'text/event-stream',body:'event: progress\ndata: '+JSON.stringify({label:'Fetching jobs'})+'\n\nevent: done\ndata: '+JSON.stringify({reply:'Assistant test response',run_id:'test-run',elapsed_ms:12000,checks:[{name:'Source match',status:'pass',detail:'Direct records'}],conversation_id:'test-chat',results:{title:'Completed deliveries',columns:['Driver','Completed loads'],rows:[['Joey','4'],['Caleb','6'],['Total','10']]}})+'\n\n'});
});
await page.goto('http://127.0.0.1:5174/v2');
await page.getByRole('button',{name:'Open dispatch assistant'}).click();
const field=page.getByPlaceholder('Ask the assistant...');
await field.fill('One');const small=(await field.boundingBox()).height;
await field.fill('One\nTwo\nThree');assert((await field.boundingBox()).height>small);
await field.fill(Array(15).fill('Line').join('\n'));assert((await field.boundingBox()).height<=258);
await field.fill('Show jobs');await field.press('Enter');
await page.getByText('Assistant test response',{exact:true}).waitFor();
await page.getByText('12 seconds',{exact:true}).waitFor();
await page.getByRole('button',{name:'Helpful',exact:true}).click();
await page.getByRole('button',{name:'Helpful saved'}).waitFor();
await page.getByRole('button',{name:'Incorrect',exact:true}).click();
await page.getByLabel('Correction',{exact:true}).fill('The count is wrong');
await page.getByRole('button',{name:'Save feedback'}).click();
await page.getByRole('button',{name:'Incorrect saved'}).waitFor();
assert.equal(feedback.length,2);assert.equal(feedback[1].correction,'The count is wrong');
await page.getByRole('button',{name:'Review',exact:true}).click();
await page.getByText('No feedback yet.',{exact:true}).waitFor();
await page.keyboard.press('Escape');
await page.setViewportSize({width:390,height:844});
assert((await field.boundingBox()).width<390);
assert.deepEqual(errors,[]);
console.log('PASS: textarea grows/caps, streamed result, elapsed, feedback, admin review, mobile');
await page.screenshot({path:'/tmp/assistant-feedback.png'});
await browser.close();

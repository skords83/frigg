import { test,expect } from '@playwright/test';
const a={uid:'synthetic',fn:'Anne Testperson',phones:[],emails:[],addresses:[]};
const b={...a,uid:'synthetic-duplicate',fn:'Anne Testperson (zweiter Eintrag)'};

test('merge preview requires decisions and an updated preview before execution',async({page,context})=>{
  await context.addCookies([{name:'frigg_sid',value:'synthetic-test-only',url:'http://127.0.0.1:4310'},{name:'duplicates',value:'yes',url:'http://127.0.0.1:4310'}]);
  let executes=0;
  const plan={id:'test-op',kind:'merge',status:'prepared',source:b,target:a,result:a,unresolved:true,rows:[{property:'NOTE',a:['NOTE:Ursprünglich'],b:['NOTE:Zusätzliche Notiz'],result:['NOTE:Ursprünglich'],conflict:true,blocked:false}]};
  await page.route('**/api/operations/preview',route=>route.fulfill({status:201,json:plan}));
  await page.route('**/api/operations/test-op/preview',async route=>{
    expect(route.request().postDataJSON().choices).toEqual({NOTE:'b'});
    await route.fulfill({json:{...plan,unresolved:false,rows:[{...plan.rows[0],result:plan.rows[0].b}]}});
  });
  await page.route('**/api/operations/test-op/execute',route=>{executes++;return route.fulfill({json:{status:'complete',contact:a}});});
  await page.goto('/');await page.getByRole('button',{name:'Duplikate prüfen'}).click();
  await page.getByRole('button',{name:'Anne Testperson',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Zusammenführung prüfen'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Zusammenführung bestätigen'})).toBeDisabled();
  await page.getByLabel('Wert B verwenden').check();
  await expect(page.getByRole('button',{name:'Zusammenführung bestätigen'})).toBeDisabled();
  expect(executes).toBe(0);
  await page.getByRole('button',{name:'Vorschau aktualisieren'}).click();
  await expect(page.getByRole('button',{name:'Zusammenführung bestätigen'})).toBeEnabled();
  await page.screenshot({path:'test-results/merge-preview.png',fullPage:true});
  await page.getByRole('button',{name:'Zusammenführung bestätigen'}).click();
  await expect(page.getByRole('heading',{name:'Zusammenführung prüfen'})).not.toBeVisible();
  expect(executes).toBe(1);
});

test('drag move prepares an operation before execution and displays partial failure',async({page,context})=>{
  await context.addCookies([{name:'frigg_sid',value:'synthetic-test-only',url:'http://127.0.0.1:4310'}]);
  const events:string[]=[];
  await page.route('**/api/operations/preview',route=>{events.push('preview');expect(route.request().postDataJSON().kind).toBe('move');return route.fulfill({status:201,json:{id:'move-op'}});});
  await page.route('**/api/operations/move-op/execute',route=>{events.push('execute');return route.fulfill({status:503,json:{error:'operation_unconfirmed'}});});
  page.on('dialog',async dialog=>{expect(dialog.message()).toContain('Offene Vorgänge');await dialog.accept();});
  await page.goto('/');
  const data=await page.evaluateHandle(()=>{const data=new DataTransfer();data.setData('text/x-contact-uid','synthetic');return data;});
  await page.getByRole('option',{name:/Synthetisch/}).locator('..').dispatchEvent('drop',{dataTransfer:data});
  await expect.poll(()=>events).toEqual(['preview','execute']);
  await expect(page.getByRole('button',{name:/Anne Testperson/})).toBeVisible();
});

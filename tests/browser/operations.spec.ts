import { test,expect } from '@playwright/test';
const a={uid:'synthetic',fn:'Anne Testperson',phones:[],emails:[],addresses:[]};
const b={...a,uid:'synthetic-duplicate',fn:'Anne Testperson (zweiter Eintrag)'};

for(const mobile of [false,true])test(`merge preview requires decisions (${mobile?'mobile':'desktop'})`,async({page,context})=>{
  await context.addCookies([{name:'frigg_sid',value:'synthetic-test-only',url:'http://127.0.0.1:4310'},{name:'duplicates',value:'yes',url:'http://127.0.0.1:4310'}]);
  let executes=0;
  const plan={id:'test-op',kind:'merge',status:'prepared',source:b,target:a,result:a,unresolved:true,rows:[{property:'NOTE',a:['NOTE:Ursprünglich'],b:['NOTE:Zusätzliche Notiz'],result:['NOTE:Ursprünglich'],conflict:true,blocked:false}]};
  await page.route('**/api/operations/preview',route=>route.fulfill({status:201,json:plan}));
  await page.route('**/api/operations/test-op/preview',async route=>{
    expect(route.request().postDataJSON().choices).toEqual({NOTE:'b'});
    await route.fulfill({json:{...plan,unresolved:false,rows:[{...plan.rows[0],result:plan.rows[0].b}]}});
  });
  await page.route('**/api/operations/test-op/execute',route=>{executes++;return route.fulfill({json:{status:'complete',contact:a}});});
  if(mobile)await page.setViewportSize({width:390,height:844});
  await page.goto('/');if(mobile)await page.getByRole('button',{name:'Navigation',exact:true}).click();
  await page.getByRole('button',{name:'Duplikate prüfen'}).click();
  await page.getByRole('button',{name:'Anne Testperson',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Zusammenführung prüfen'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Zusammenführung bestätigen'})).toBeDisabled();
  await page.getByLabel('Wert B verwenden').check();
  await expect(page.getByRole('button',{name:'Zusammenführung bestätigen'})).toBeDisabled();
  expect(executes).toBe(0);
  await page.getByRole('button',{name:'Vorschau aktualisieren'}).click();
  await expect(page.getByRole('button',{name:'Zusammenführung bestätigen'})).toBeEnabled();
  await page.screenshot({path:`test-results/merge-${mobile?'mobile':'desktop'}.png`,fullPage:true});
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

test('mobile navigation supports touch move and reports delete conflicts',async({page,context})=>{
  await context.addCookies([{name:'frigg_sid',value:'synthetic-test-only',url:'http://127.0.0.1:4310'},{name:'two-books',value:'yes',url:'http://127.0.0.1:4310'}]);
  await page.setViewportSize({width:390,height:844});
  const events:string[]=[];
  await page.route('**/api/operations/preview',r=>{events.push('preview');expect(r.request().postDataJSON()).toEqual({kind:'move',source_uid:'synthetic',target_book_id:'second-book'});return r.fulfill({status:201,json:{id:'mobile-move'}});});
  await page.route('**/api/operations/mobile-move/execute',r=>{events.push('execute');return r.fulfill({status:503,json:{error:'operation_unconfirmed'}});});
  page.on('dialog',d=>d.accept());
  await page.goto('/');
  await page.getByRole('button',{name:/Anne Testperson/}).click();
  await expect(page.getByRole('button',{name:'Bearbeiten',exact:true})).toBeVisible();
  await page.getByLabel('Verschieben nach').selectOption('second-book');
  await page.getByRole('button',{name:'Verschieben',exact:true}).click();
  await expect.poll(()=>events).toEqual(['preview','execute']);
  await page.route('**/api/contacts/synthetic',r=>r.fulfill({status:409,json:{error:'conflict'}}));
  await page.getByRole('button',{name:'Löschen',exact:true}).click();
  await page.locator('.modal-panel').getByRole('button',{name:'Löschen',exact:true}).click();
  await expect(page.getByRole('alert').filter({hasText:'zwischenzeitlich geändert'})).toBeVisible();
  await page.screenshot({path:'test-results/mobile-detail.png',fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole('button',{name:'Navigation',exact:true}).click();
  await expect(page.getByTitle('Neue Gruppe',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Kontakte',exact:true}).click();
  await expect(page.getByRole('button',{name:/Anne Testperson/})).toBeVisible();
});

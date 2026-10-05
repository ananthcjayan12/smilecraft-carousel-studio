const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const available=`COALESCE((SELECT SUM(amount) FROM credit_ledger WHERE account_id=? AND (expires_at IS NULL OR expires_at>datetime('now'))),0)-COALESCE((SELECT SUM(amount) FROM credit_reservations WHERE account_id=? AND status='reserved'),0)`;
export async function adjustCredits(request,env,viewer,accountId){
 if(!env.ADMIN_EMAIL||viewer.email?.toLowerCase()!==env.ADMIN_EMAIL.toLowerCase())return json({error:'Not authorized.'},403);
 let input;try{input=await request.json()}catch{return json({error:'Expected a JSON object.'},400);}
 if(!input||typeof input!=='object'||Array.isArray(input))return json({error:'Expected a JSON object.'},400);
 const {mode,amount,expectedBalance,requestId}=input,reason=String(input.reason||'').trim();
 if(!['add','remove','set'].includes(mode)||!Number.isSafeInteger(amount)||amount<0||amount>1_000_000||(mode!=='set'&&amount===0))return json({error:'Enter a whole credit amount between 1 and 1,000,000 (zero is allowed when setting a balance).'},400);
 if(!Number.isSafeInteger(expectedBalance)||typeof requestId!=='string'||! /^[a-zA-Z0-9-]{16,100}$/.test(requestId)||!reason||reason.length>500)return json({error:'Provide the displayed balance, a request ID and a reason (up to 500 characters).'},400);
 const first=(sql,...args)=>env.DB.prepare(sql).bind(...args).first();
 if(!await first('SELECT id FROM accounts WHERE id=?',accountId))return json({error:'Account not found.'},404);
 const existing=await first('SELECT * FROM admin_credit_adjustments WHERE id=?',requestId);
 if(existing){if(existing.account_id!==accountId||existing.mode!==mode||existing.before_balance!==expectedBalance||existing.reason!==reason||(mode==='set'?existing.after_balance:Math.abs(existing.amount))!==amount)return json({error:'This request ID was already used for another adjustment.'},409);return json({accountId,credits:existing.after_balance,adjustmentId:requestId});}
 const delta=mode==='set'?amount-expectedBalance:mode==='remove'?-amount:amount;
 if(delta===0||expectedBalance+delta<0)return json({error:delta===0?'The balance is already set to this amount.':'You cannot remove more than the available credits.'},400);
 await env.DB.batch([
  env.DB.prepare(`INSERT OR IGNORE INTO credit_ledger(id,account_id,amount,kind,source_id) SELECT ?,?,?,'admin_adjustment',? WHERE (${available})=? AND (${available})+?>=0`).bind(`admin:${requestId}`,accountId,delta,`admin:${requestId}`,accountId,accountId,expectedBalance,accountId,accountId,delta),
  env.DB.prepare('INSERT OR IGNORE INTO admin_credit_adjustments(id,account_id,admin_user_id,admin_email,mode,amount,before_balance,after_balance,reason) SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM credit_ledger WHERE id=? AND account_id=?)').bind(requestId,accountId,viewer.user_id||'',viewer.email,mode,delta,expectedBalance,expectedBalance+delta,reason,`admin:${requestId}`,accountId)
 ]);
 const saved=await first('SELECT * FROM admin_credit_adjustments WHERE id=?',requestId);
 if(saved&&(saved.account_id!==accountId||saved.mode!==mode||saved.before_balance!==expectedBalance||saved.reason!==reason||(mode==='set'?saved.after_balance:Math.abs(saved.amount))!==amount))return json({error:'This request ID was already used for another adjustment.'},409);
 if(!saved)return json({error:'The balance changed. Refresh clinic accounts before adjusting credits.'},409);
 return json({accountId,credits:saved.after_balance,adjustmentId:requestId});
}

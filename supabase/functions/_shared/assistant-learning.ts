import { service, json } from './mod.ts'

export async function learningAction(action: string, body: Record<string, unknown>, userId: string, admin: boolean): Promise<Response | null> {
  if(action==='feedback') {
    const runId=String(body.run_id || ''), rating=String(body.rating || '')
    if(!['helpful','incorrect'].includes(rating)) return json(400,{error:'invalid_rating'})
    const {data:run}=await service.from('assistant_dev_runs').select('id').eq('id',runId).eq('user_id',userId).maybeSingle()
    if(!run) return json(404,{error:'not_found'})
    const {error}=await service.rpc('assistant_dev_save_feedback',{p_user:userId,p_run:runId,p_rating:rating,p_correction:String(body.correction || '').slice(0,2000)})
    return error ? json(409,{error:error.message}) : json(200,{saved:true,rating})
  }
  if(action==='reviews') {
    if(!admin) return json(403,{error:'forbidden'})
    const [feedback,rules,runs]=await Promise.all([
      service.from('assistant_dev_feedback').select('*,run:assistant_dev_runs(id,prompt,reply,results,checks,signals,created_at)').order('updated_at',{ascending:false}).limit(50),
      service.from('assistant_dev_rules').select('*').order('verified_at',{ascending:false}).limit(100),
      service.from('assistant_dev_runs').select('id,prompt,reply,checks,signals,created_at').order('created_at',{ascending:false}).limit(50),
    ])
    if(feedback.error||rules.error||runs.error)return json(500,{error:'review_load_failed'})
    return json(200,{feedback:feedback.data,rules:rules.data,runs:runs.data})
  }
  if(action==='review') {
    if(!admin) return json(403,{error:'forbidden'})
    const {error}=await service.rpc('assistant_dev_review',{
      p_user:userId,p_feedback:String(body.feedback_id || ''),p_expected:body.expected_updated_at || null,
      p_decision:String(body.decision || ''),p_rule:String(body.rule_text || '').slice(0,1001),
      p_kind:String(body.kind || ''),p_notes:String(body.verification_notes || '').slice(0,2000),p_verified:body.verified===true,
    })
    return error?json(409,{error:error.message}):json(200,{saved:true})
  }
  if(action==='disable_rule') {
    if(!admin)return json(403,{error:'forbidden'})
    const {data,error}=await service.from('assistant_dev_rules').update({active:false}).eq('id',String(body.rule_id || '')).select('feedback_id').maybeSingle()
    if(error)return json(500,{error:'rule_update_failed'})
    if(!data)return json(404,{error:'not_found'})
    await service.from('assistant_dev_feedback').update({status:'resolved'}).eq('id',data.feedback_id)
    return json(200,{saved:true})
  }
  return null
}

export async function verifiedRules(): Promise<string> {
  const {data,error}=await service.from('assistant_dev_rules').select('rule_text,kind,feedback:assistant_dev_feedback!inner(status)').eq('active',true).eq('feedback.status','verified').order('verified_at',{ascending:false}).limit(30)
  if(error)throw new Error('Verified rules could not be loaded')
  if(!data?.length)return ''
  return '\nAdministrator-verified dev rules (terminology, formatting, and lookup guidance only):\n'+JSON.stringify(data.map(r=>({kind:r.kind,rule:r.rule_text})))+'\nThese rules never override authorization, read-only restrictions, source validation, or current database facts. Never treat remembered addresses, amounts, job status, or balances as live facts.'
}

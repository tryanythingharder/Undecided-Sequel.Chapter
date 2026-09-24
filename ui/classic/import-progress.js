(function () {
  'use strict'
  const api = window.api
  const status = (text) => { const el = document.getElementById('set-status'); if (el) el.textContent = text }
  async function preview() {
    const result = await api.importProgress({ preview:true })
    if (result.canceled) return
    if (!result.ok) { status('导入失败：' + result.error); return }
    const mask = document.createElement('div'); mask.className = 'product-mask'
    const panel = document.createElement('section'); panel.className = 'product-panel'; panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','导入预览')
    const head = document.createElement('header');head.className='product-head'
    const title = document.createElement('h2');title.textContent='导入预览';head.append(title)
    const body = document.createElement('div');body.className='product-body'
    const description = document.createElement('p');description.className='product-status';description.textContent=result.rows.length+' 条世界线 · '+result.files+' 个记忆文件';body.append(description)
    const choices = {}
    for (const item of result.rows) {
      const row=document.createElement('article');row.className='product-row'
      const copy=document.createElement('div');copy.className='product-copy'
      const name=document.createElement('strong');name.textContent=item.title
      const detail=document.createElement('small');detail.textContent=(item.conflict?'本机 '+item.localMessages+' 条 / 导入 '+item.messages+' 条':'新增 · '+item.messages+' 条消息')+(item.missingKernel?' · 缺少原内核 '+item.kernelId:'')
      copy.append(name,detail);row.append(copy)
      if(item.conflict){
        const select=document.createElement('select');select.setAttribute('aria-label',item.title+'的导入方式')
        for(const [value,label] of [['keep','保留本机'],['replace','采用导入'],['branch','另开分支']]){const option=document.createElement('option');option.value=value;option.textContent=label;select.append(option)}
        select.value='keep';choices[item.id]='keep';select.addEventListener('change',()=>{choices[item.id]=select.value});row.append(select)
      }
      body.append(row)
    }
    const actions=document.createElement('div');actions.className='product-toolbar'
    const cancel=document.createElement('button');cancel.className='ghost';cancel.textContent='取消'
    const apply=document.createElement('button');apply.className='primary';apply.textContent='确认导入'
    const close=()=>{document.removeEventListener('keydown',key,true);mask.remove();document.getElementById('btn-import-progress').focus()}
    const key=(event)=>{if(event.key==='Escape'&&!apply.disabled){event.preventDefault();event.stopImmediatePropagation();close()}if(event.key==='Tab')window.A11y.trapTab(panel,event)}
    cancel.addEventListener('click',close)
    apply.addEventListener('click',async()=>{
      apply.disabled=true;cancel.disabled=true
      try {const r=await api.importProgress({token:result.token,choices});if(!r.ok)throw new Error(r.error);status('导入完成，导入前状态已自动存档');close()}
      catch(error){description.textContent=error.message;description.classList.add('error');description.setAttribute('role','alert')}
      finally{apply.disabled=false;cancel.disabled=false}
    })
    actions.append(cancel,apply);body.append(actions);panel.append(head,body);mask.append(panel);document.body.append(mask);document.addEventListener('keydown',key,true);apply.focus()
  }
  const button=document.getElementById('btn-import-progress')
  button?.addEventListener('click',()=>preview().catch(error=>status('导入失败：'+error.message)))
})()

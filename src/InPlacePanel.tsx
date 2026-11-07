import {useEffect,useId,useRef} from 'react';
import type {ReactNode} from 'react';
import {Button} from './ui';

type PanelControls={close:(afterClose?:()=>void)=>void};

export function InPlacePanel({title,onClose,children,className='',open=true}:{
 title:string;
 onClose:()=>void;
 children:ReactNode|((controls:PanelControls)=>ReactNode);
 className?:string;
 open?:boolean;
}){
 const dialog=useRef<HTMLDialogElement>(null),opener=useRef<HTMLElement|null>(null);
 const token=useRef(crypto.randomUUID()),closing=useRef(false),after=useRef<(()=>void)|undefined>(undefined);
 const active=useRef(false);
 const titleId=useId();

 const finish=()=>{
  if(closing.current===false&&dialog.current?.open===false)return;
  closing.current=false;
  dialog.current?.close();
  onClose();
  const next=after.current;after.current=undefined;
  requestAnimationFrame(()=>{opener.current?.focus();next?.();});
 };
 const close=(afterClose?:()=>void)=>{
  if(closing.current)return;
  closing.current=true;after.current=afterClose;
  if(history.state?.planzoPanel===token.current)history.back();
  else finish();
 };

 useEffect(()=>{
  if(!open)return;
  const element=dialog.current;
  active.current=true;
  if(history.state?.planzoPanel!==token.current){
   opener.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
   const state={...(history.state&&typeof history.state==='object'?history.state:{}),planzoPanel:token.current};
   history.pushState(state,'',location.href);
  }
  if(element&&!element.open)element.showModal();
  document.body.classList.add('panel-open');
  const popped=()=>finish();
  window.addEventListener('popstate',popped);
  return()=>{
   window.removeEventListener('popstate',popped);
   document.body.classList.remove('panel-open');
   active.current=false;
   if(element?.open)element.close();
   // React can replay effects during mounting. Leave its history entry in place.
   queueMicrotask(()=>{
    if(!active.current&&history.state?.planzoPanel===token.current){
     const clean={...history.state};delete clean.planzoPanel;
     history.replaceState(clean,'',location.href);
    }
   });
  };
 },[open]);

 return <dialog ref={dialog} className={'in-place-panel '+className} aria-labelledby={titleId} onCancel={event=>{event.preventDefault();close();}}>
  <div className="panel-frame">
   <header className="panel-header"><h2 id={titleId}>{title}</h2><Button variant="ghost" className="panel-close" onClick={()=>close()}>Close</Button></header>
   <div className="panel-body">{typeof children==='function'?children({close}):children}</div>
  </div>
 </dialog>;
}

'use client';
import {useState,useCallback,useEffect} from 'react';
import type {ContactGroup} from '../types/contact';
export function useGroups() {
  const [groups,setGroups]=useState<ContactGroup[]>([]),[error,setError]=useState<string|null>(null);
  const refresh=useCallback(async()=>{const res=await fetch('/api/groups');if(res.ok)setGroups(await res.json());},[]);
  useEffect(()=>{void refresh();const interval=setInterval(()=>{void refresh();},30_000);return()=>clearInterval(interval);},[refresh]);
  const request=useCallback(async(id:string,method:string,suffix='',body?:unknown)=>{
    const group=groups.find(g=>g.id===id),dav=group?.kind==='carddav';
    const res=await fetch(`/api/${dav?'carddav-groups':'groups'}/${encodeURIComponent(id)}${suffix}`,{method,headers:{'Content-Type':'application/json',...(dav?{'If-Match':group.etag??''}:{})},body:body?JSON.stringify(body):undefined});
    if(!res.ok) {
      const problem=await res.json().catch(()=>({}));
      if(problem.server)setGroups(prev=>prev.map(g=>g.id===id?problem.server:g));
      else if(dav) {const current=await fetch(`/api/carddav-groups/${encodeURIComponent(id)}`);if(current.ok){const fresh=await current.json();setGroups(prev=>prev.map(g=>g.id===id?fresh:g));}}
      setError(res.status===409?'Die Gruppe wurde geändert oder ein Kontaktvorgang ist noch offen. Bitte die aktuelle Gruppe prüfen und erneut entscheiden.':'Die Gruppenänderung ist nicht bestätigt. Nicht unterstützte Formate oder Kontakte aus einem anderen Adressbuch können nicht geändert werden.');
      return false;
    }
    setError(null);await refresh();return true;
  },[groups,refresh]);
  const createGroup=useCallback(async(name:string,options?:{addressbook_id:string;format:'vcard4'|'apple'})=>{
    const res=await fetch(options?'/api/carddav-groups':'/api/groups',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,...options})});
    if(!res.ok){setError('Gruppe konnte nicht angelegt werden. Serverformat und Berechtigung prüfen.');return null;}
    const group:ContactGroup=await res.json();setGroups(prev=>[...prev,group]);setError(null);return group;
  },[]);
  return {groups,error,clearError:()=>setError(null),refresh,createGroup,
    renameGroup:(id:string,name:string)=>request(id,'PATCH','',{name}),
    deleteGroup:(id:string)=>request(id,'DELETE'),
    addMember:(id:string,uid:string)=>request(id,'POST','/members',{contact_uid:uid}),
    removeMember:(id:string,uid:string)=>request(id,'DELETE',`/members/${encodeURIComponent(uid)}`),
  };
}

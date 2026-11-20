/* Durable per-account snapshots and transactional attendance outbox. */
window.HathirOfflineStore = (() => {
  let connection;
  const failureReviewOwner=crypto.randomUUID();
  const changes=typeof BroadcastChannel==='function'?new BroadcastChannel('hathir-offline-changes-v1'):null;
  const notifyChange=()=>window.dispatchEvent(new Event('hathir-offline-change'));
  if(changes)changes.onmessage=notifyChange;
  async function db() {
    if (!connection) connection = new Promise((resolve,reject)=>{
      // Original-origin upgrade: retain the durable outbox and every receipt ID.
      const request=indexedDB.open('hathir-offline-v1',1);
      request.onupgradeneeded=()=>{request.result.createObjectStore('subjects',{keyPath:'key'});request.result.createObjectStore('operations',{keyPath:'id'});};
      request.onsuccess=()=>{request.result.onversionchange=()=>{request.result.close();connection=null;};resolve(request.result);};
      request.onerror=()=>{connection=null;reject(request.error);};
    });
    return connection;
  }
  async function transaction(stores,mode,work) {
    const database=await db();
    return new Promise((resolve,reject)=>{
      const tx=database.transaction(stores,mode);let result;
      tx.oncomplete=()=>{resolve(result);if(mode==='readwrite'){notifyChange();changes?.postMessage('changed');}};tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.hathirAbortError || tx.error || Error('Local save aborted'));
      work(tx,value=>{result=value});
    });
  }
  const key=(uid,subjectId)=>uid+':'+subjectId;
  async function list(store,uid) {return transaction([store],'readonly',(tx,result)=>{
    // The existing subject primary key already scopes this read to one account.
    // Keep the UID filter as a second check (including custom UIDs with colons).
    // Operations have UUID keys; do not pretend a cursor can skip their payloads
    // without a schema/index migration that older open tabs do not understand.
    const range=store==='subjects'?IDBKeyRange.bound(String(uid)+':',String(uid)+';',false,true):undefined;
    const req=tx.objectStore(store).getAll(range);req.onsuccess=()=>result(req.result.filter(r=>r.uid===uid));
  });}
  const acknowledgeMany=ids=>transaction(['subjects','operations'],'readwrite',tx=>{
    const operations=tx.objectStore('operations'),subjects=tx.objectStore('subjects');
    const accepted=[...new Set(ids)],affected=new Map();let remaining=accepted.length;
    const advanceRevisions=()=>{
      for(const [subjectKey,workspaces] of affected){
        const saved=subjects.get(subjectKey);
        saved.onsuccess=()=>{
          const snapshot=saved.result;
          if(snapshot&&workspaces.has(snapshot.workspaceId)){
            // One rewrite per subject, not per accepted mark. The revision must
            // stay on the legacy snapshot so old and new tabs share the fence.
            snapshot.localRevision=crypto.randomUUID();subjects.put(snapshot);
          }
        };
      }
    };
    for(const id of accepted){
      const request=operations.get(id);
      request.onsuccess=()=>{
        const op=request.result;
        if(op){
          const subjectKey=key(op.uid,op.subjectId);
          if(!affected.has(subjectKey))affected.set(subjectKey,new Set());
          affected.get(subjectKey).add(op.workspaceId);
          operations.delete(id);
        }
        if(--remaining===0)advanceRevisions();
      };
    }
  });
  return {
    key,
    subjects:uid=>list('subjects',uid),
    subject:(uid,subjectId)=>transaction(['subjects'],'readonly',(tx,result)=>{
      const request=tx.objectStore('subjects').get(key(uid,subjectId));
      request.onsuccess=()=>{const snapshot=request.result;result(snapshot&&snapshot.uid===uid&&snapshot.subject?.id===subjectId?snapshot:null);};
    }),
    operations:uid=>list('operations',uid),
    reconcileTrialReset:(uid,workspaceId,subjects)=>transaction(['subjects','operations'],'readwrite',tx=>{
      // Called only after authoritative subject metadata reads. The owner
      // explicitly requested removal of all trial data, including old outboxes.
      const resets=new Map(subjects.filter(s=>String(s.lastRosterResetId||'').startsWith('trial-reset-')).map(s=>[s.id,s.lastRosterResetId]));
      for(const name of ['subjects','operations']){
        const store=tx.objectStore(name),request=store.getAll();
        request.onsuccess=()=>{for(const item of request.result){
          const id=name==='subjects'?item.subject?.id:item.subjectId;
          const epoch=name==='subjects'?item.subject?.lastRosterResetId:item.rosterResetId;
          if(item.uid===uid&&item.workspaceId===workspaceId&&resets.has(id)&&epoch!==resets.get(id))store.delete(name==='subjects'?item.key:item.id);
        }};
      }
    }),
    requestFailureReview:(id,uid,workspaceId)=>transaction(['operations'],'readwrite',(tx,result)=>{
      const store=tx.objectStore('operations'),request=store.get(id);
      request.onsuccess=()=>{
        const operation=request.result;
        if(!operation?.error||operation.uid!==uid||operation.workspaceId!==workspaceId||operation.failureReviewLeaseUntil>Date.now()){result(false);return;}
        // Preserve identity, payload, order and base revisions. This is only a
        // user-requested exact revalidation, never an overwrite or a new mark.
        store.put({...operation,failureReviewState:'pending',failureReviewLeaseUntil:0,failureReviewLeaseOwner:null});result(true);
      };
    }),
    saveReceived:(snapshot,revision)=>transaction(['subjects'],'readwrite',(tx,result)=>{
      const store=tx.objectStore('subjects'),request=store.get(snapshot.key);
      request.onsuccess=()=>{const previous=request.result;
        if(!previous||previous.uid!==snapshot.uid||previous.workspaceId!==snapshot.workspaceId||(previous.localRevision||'')!==revision){result(false);return;}
        store.put({...snapshot,localRevision:crypto.randomUUID()});result(true);
      };
    }),
    save:snapshot=>transaction(['subjects','operations'],'readwrite',tx=>{
      const store=tx.objectStore('subjects'),request=store.get(snapshot.key);
      // Explicit owner-authorized trial-data reset. Apply only a freshly
      // prepared server epoch, never a generic application upgrade.
      const reset=snapshot.subject?.lastRosterResetId;
      const trialReset=typeof reset==='string'&&reset.startsWith('trial-reset-');
      if(trialReset){
        const operations=tx.objectStore('operations'),all=operations.getAll();
        all.onsuccess=()=>{for(const op of all.result)if(op.uid===snapshot.uid&&op.workspaceId===snapshot.workspaceId&&op.subjectId===snapshot.subject.id&&op.rosterResetId!==reset)operations.delete(op.id);};
      }
      request.onsuccess=()=>{
        const previous=request.result;
        if(previous&&previous.uid===snapshot.uid&&previous.workspaceId===snapshot.workspaceId&&(!(trialReset&&previous.subject?.lastRosterResetId!==reset)&&previous.subject?.offlineEpochPending||Number(previous.subject?.attendanceClearedAtMillis||0)>Number(snapshot.subject.attendanceClearedAtMillis||0))){
          tx.hathirAbortError=Object.assign(Error('A newer attendance clear exists on this device; refresh before preparing.'),{code:'offline-stale-epoch'});tx.abort();return;
        }
        store.put({...snapshot,localRevision:crypto.randomUUID()});
      };
    }),
    requireAttendanceRefresh:(uid,subjectId,workspaceId=uid)=>transaction(['subjects'],'readwrite',(tx,result)=>{
      const store=tx.objectStore('subjects'),request=store.get(key(uid,subjectId));
      request.onsuccess=()=>{
        const snapshot=request.result;
        if(!snapshot||snapshot.uid!==uid||snapshot.workspaceId!==workspaceId||snapshot.subject?.id!==subjectId){result(false);return;}
        if(!snapshot.subject.offlineEpochPending){snapshot.subject.offlineEpochPending=true;snapshot.localRevision=crypto.randomUUID();store.put(snapshot);}
        result(true);
      };
    }),
    savePrepared:(snapshot,expectedRevision)=>transaction(['subjects'],'readwrite',(tx,result)=>{
      const store=tx.objectStore('subjects'),request=store.get(snapshot.key);
      request.onsuccess=()=>{
        const previous=request.result;
        if((previous?.localRevision||'')!==expectedRevision||previous&&(previous.uid!==snapshot.uid||previous.workspaceId!==snapshot.workspaceId)||
          Number(previous?.subject?.attendanceClearedAtMillis||0)>Number(snapshot.subject.attendanceClearedAtMillis||0)){result(false);return;}
        // A full authoritative refresh may replace only the revision it read.
        // This transaction never changes or removes any pending operation.
        store.put({...snapshot,localRevision:crypto.randomUUID()});result(true);
      };
    }),
    updateFaceSupport:(scope,update,expectedRevision)=>transaction(['subjects'],'readwrite',(tx,result)=>{
      const store=tx.objectStore('subjects'),request=store.get(key(scope.uid,scope.subjectId));
      request.onsuccess=()=>{
        const snapshot=request.result,s=snapshot?.subject;
        if(!s||snapshot.uid!==scope.uid||snapshot.workspaceId!==scope.workspaceId||s.id!==scope.subjectId||
          (snapshot.localRevision||'')!==expectedRevision||(s.rosterCohortId||'')!==scope.rosterCohortId||
          (s.lastRosterResetId||'')!==scope.rosterResetId||(s.attendanceClearedAtMillis||0)!==scope.attendanceClearedAtMillis){result({saved:false});return;}
        // A scanner may have loaded templates into memory after the QR-only
        // snapshot. Asset-only success must not hide that missing durable step.
        if(update.offlineFaceAssetsReady===true&&!Array.isArray(update.students)&&s.faceTemplatesLoaded!==true){result({saved:false});return;}
        if(Array.isArray(update.students)){
          const templates=new Map(update.students.map(student=>[String(student.id),student]));
          if((s.students||[]).some(student=>!templates.has(String(student.id)))){result({saved:false});return;}
          // Only a fresh template read supplies students. Never copy names,
          // roster membership, history or outbox from a potentially old page.
          s.students=(s.students||[]).map(student=>{
            const saved=templates.get(String(student.id));
            return {...student,faceDescriptor:saved.faceDescriptor||null,faceDescriptors:saved.faceDescriptors||[],faceDescriptorMap:saved.faceDescriptorMap||{}};
          });
          s.faceTemplatesLoaded=update.faceTemplatesLoaded===true;
        }
        // Asset completion / already-loaded memory updates metadata only;
        // even biometrics changed before our revision read remain untouched.
        s.offlineFaceAssetsReady=update.offlineFaceAssetsReady===true;
        s.offlineFacePreparationState=update.offlineFacePreparationState;
        snapshot.savedAt=Date.now();snapshot.localRevision=crypto.randomUUID();
        store.put(snapshot);result({saved:true,revision:snapshot.localRevision});
      };
    }),
    readState:(uid,subjectId)=>transaction(['subjects','operations'],'readonly',(tx,result)=>{
      const snapshot=tx.objectStore('subjects').get(key(uid,subjectId));
      const operations=tx.objectStore('operations').getAll();
      let saved,ops;
      const finish=()=>{if(saved!==undefined&&ops!==undefined)result({revision:saved?.localRevision||'',operations:ops.filter(o=>o.uid===uid&&o.subjectId===subjectId)});};
      snapshot.onsuccess=()=>{saved=snapshot.result||null;finish();};
      operations.onsuccess=()=>{ops=operations.result;finish();};
    }),
    removeAttendance:(scope,date,studentId)=>transaction(['subjects'],'readwrite',tx=>{
      const store=tx.objectStore('subjects'),request=store.get(key(scope.uid,scope.subjectId));
      request.onsuccess=()=>{
        const snapshot=request.result,s=snapshot?.subject;
        if(!s||snapshot.uid!==scope.uid||snapshot.workspaceId!==scope.workspaceId||
          (s.lastRosterResetId||'')!==scope.rosterResetId||(s.attendanceClearedAtMillis||0)!==scope.attendanceClearedAtMillis)return;
        if(s.attendance?.[date])delete s.attendance[date][studentId];
        s.summaryLoaded=false;s.attendanceStatsDirty=true;snapshot.savedAt=Date.now();store.put(snapshot);
      };
    }),
    enqueue:(snapshot,operation)=>transaction(['subjects','operations'],'readwrite',tx=>{
      const store=tx.objectStore('subjects'),request=store.get(snapshot.key);
      request.onsuccess=()=>{
        const previous=request.result,old=previous?.subject,current=snapshot.subject;
        if(old&&previous.uid===snapshot.uid&&previous.workspaceId===snapshot.workspaceId&&
          (old.offlineEpochPending||Number(old.attendanceClearedAtMillis||0)>Number(current.attendanceClearedAtMillis||0))){
          tx.hathirAbortError=Object.assign(Error('Attendance was refreshed after a clear in another tab; refresh before recording.'),{code:'offline-stale-epoch'});tx.abort();return;
        }
        // An online session can scan before older lecture pages finish loading.
        // Keep that history in the durable snapshot, but never cross accounts,
        // a roster replacement or an attendance reset. Current loaded days win.
        if(old&&previous.uid===snapshot.uid&&previous.workspaceId===snapshot.workspaceId&&!current.attendanceLoaded&&
          ['rosterCohortId','lastRosterResetId','attendanceClearedAtMillis'].every(k=>(old[k]||'')===(current[k]||''))){
          const attendance={...old.attendance,...current.attendance},excuses={...old.excuses,...current.excuses};
          const dates=current.lectureIndexComplete?(current.lectures||[]):[...new Set([...(old.lectures||[]),...(current.lectures||[])])].sort();
          if(current.lectureIndexComplete)for(const date of Object.keys(attendance))if(!dates.includes(date))delete attendance[date];
          snapshot={...snapshot,subject:{...current,attendance,excuses,lectures:dates,lectureMeta:{...old.lectureMeta,...current.lectureMeta}}};
        }
        const operations=tx.objectStore('operations'),pending=operations.getAll();
        pending.onsuccess=()=>{
          // UUID order is not entry order when operations share a millisecond.
          // Allocate FIFO order atomically across tabs with the snapshot write.
          operation.queueOrder=pending.result.reduce((last,o)=>Math.max(last,Number(o.queueOrder||o.createdAt||0)+1),Date.now());
          store.put({...snapshot,localRevision:crypto.randomUUID()});operations.add(operation);
        };
      };
    }),
    acknowledge:id=>acknowledgeMany([id]),
    acknowledgeMany,
    claimFailureReview:(id,version)=>transaction(['operations'],'readwrite',(tx,result)=>{
      const store=tx.objectStore('operations'),request=store.get(id);
      request.onsuccess=()=>{
        const operation=request.result;
        if(!operation?.error){result(null);return;}
        const sameVersion=operation.failureReviewVersion===version,now=Date.now();
        if(sameVersion&&(operation.failureReviewState!=='pending'||
          operation.failureReviewLeaseUntil>now&&operation.failureReviewLeaseOwner!==failureReviewOwner)){result(null);return;}
        // A 180s lease exceeds the callable's 120s timeout. The same tab renews
        // it before a transport retry; another tab/reload may reclaim only an
        // unfinished, expired lease. Definitive rejection is marked done.
        // Preserve the original error and every submitted payload field.
        const claimed={...operation,failureReviewVersion:version,failureReviewState:'pending',failureReviewLeaseOwner:failureReviewOwner,failureReviewLeaseUntil:now+180000};
        store.put(claimed);result(claimed);
      };
    }),
    fail:operation=>transaction(['operations'],'readwrite',tx=>{
      const store=tx.objectStore('operations'),request=store.get(operation.id);
      // A late response in another tab must not resurrect an acknowledged op.
      request.onsuccess=()=>{if(request.result)store.put({...request.result,...operation});};
    })
  };
})();

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const create=require('../account-presence');
function fixture(){
 let time=1000000;const rows=new Map();
 const service=create({db:{collection:name=>{assert.equal(name,'attendanceAccountPresence');return {doc:uid=>({set:async data=>rows.set(uid,data),get:async()=>({exists:rows.has(uid),data:()=>rows.get(uid)})})};}},
 approvedIdentity:async request=>{if(request.auth?.uid!=='teacher')throw Error('denied');return {user:{uid:'teacher'}};},
 ownerIdentity:async request=>{if(request.auth?.uid!=='owner')throw Error('denied');},fail:(code)=>{throw Error(code);},now:()=>time});
 return {rows,service,advance:n=>time+=n,beat:data=>service({auth:{uid:'teacher'},data:{action:'beat',...data}}),list:uids=>service({auth:{uid:'owner'},data:{action:'list',uids}})};
}
test('Heartbeat uses authenticated identity and server time, ignoring forged target and time',async()=>{const f=fixture();await f.beat({uid:'victim',lastSeen:9999999});assert.deepEqual([...f.rows],[['teacher',{lastSeen:1000000}]]);});
test('Presence expires after three minutes; missing record stays unknown; last seen retained',async()=>{const f=fixture();await f.beat();assert.equal((await f.list(['teacher'])).accounts[0].online,true);f.advance(180000);assert.equal((await f.list(['teacher'])).accounts[0].online,false);assert.equal((await f.list(['teacher'])).accounts[0].lastSeen,1000000);assert.deepEqual((await f.list(['missing'])).accounts[0],{uid:'missing',online:false,lastSeen:0});});
test('Only owner can read presence and only approved identity can write',async()=>{const f=fixture();await assert.rejects(f.service({auth:{uid:'teacher'},data:{action:'list',uids:['owner']}}),/denied/);await assert.rejects(f.service({data:{action:'beat'}}),/denied/);assert.equal(f.rows.size,0);});
test('Bounded requests reject path injection and unknown actions',async()=>{const f=fixture();for(const ids of [Array(101).fill('a'),['../victim'],[null]])await assert.rejects(f.list(ids),/invalid-argument/);await assert.rejects(f.service({data:{action:'delete'}}),/invalid-argument/);});
test('Independent devices only refresh last seen; no offline overwrite of other active device',async()=>{const f=fixture();await f.beat();f.advance(150000);await f.beat();f.advance(90000);assert.equal((await f.list(['teacher','teacher'])).accounts.length,1);assert.equal((await f.list(['teacher'])).accounts[0].online,true);});

'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const load = () => import(pathToFileURL(path.join(__dirname, '../ui/js/mouse-relay.js')));
test('Relais souris : un état figé expire en arrière-plan, un vrai nouveau rapport reprend', async () => {
  const {createMouseFreshness} = await load(), state = createMouseFreshness();
  const pad = {index:0,id:'Xbox',axes:[0,0,0.8,0],buttons:[{pressed:false}],timestamp:10};
  assert.equal(state.fresh(pad,1000,true),true);
  assert.equal(state.fresh(pad,1500,true),true);
  assert.equal(state.fresh(pad,1700,false),true);
  assert.equal(state.fresh(pad,1801,false),false);
  pad.timestamp=11;assert.equal(state.fresh(pad,1810,false),true);
  pad.axes[2]=0;assert.equal(state.fresh(pad,2200,false),true);
  assert.equal(state.fresh(pad,2501,false),false);
});
test('Relais souris : boutons, manettes distinctes et réinitialisation', async () => {
  const {createMouseFreshness} = await load(), state = createMouseFreshness();
  const pad = {index:0,id:'PS4',axes:[0,0,0,0],buttons:[{pressed:false}]};
  state.fresh(pad,1000,true); assert.equal(state.fresh(pad,1400,false),false);
  pad.buttons[0].pressed=true;assert.equal(state.fresh(pad,1410,false),true);
  assert.equal(state.fresh({...pad,index:1},1800,false),true);
  assert.equal(state.fresh(pad,1800,false),false);
  state.reset();assert.equal(state.fresh(pad,1800,false),true);
});

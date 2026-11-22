'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
test('os slides foram removidos da mesa e dos comandos conforme escolha do operador',()=>{
  const html=read('public/index.html'),commands=read('public/commands.js');
  assert.doesNotMatch(html, /src=\"\/slides(?:-pptx)?\.js/);
  assert.doesNotMatch(commands, /id: 'slides'|id: 'slideprev'|id: 'slidenext'/);
});

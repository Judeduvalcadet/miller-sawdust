import test from 'node:test';
import assert from 'node:assert/strict';
import {splitAssistantRows} from '../src/lib/assistantResults.js';
test('completed delivery tables hide zero rows and separate totals',()=>{
 const result=splitAssistantRows({columns:['Driver','Completed loads'],rows:[['Total','15'],['Joey','4'],['Josh','0'],['Caleb','6'],['Rodney','5']]});
 assert.deepEqual(result.rows,[['Joey','4'],['Caleb','6'],['Rodney','5']]);
 assert.deepEqual(result.totals,[['Total','15']]);
});
test('zero values in unrelated data remain visible',()=>{
 assert.equal(splitAssistantRows({columns:['Item','Price'],rows:[['Free item','0']]}).rows.length,1);
});

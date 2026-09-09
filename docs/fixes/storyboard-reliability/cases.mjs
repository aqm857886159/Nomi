export const cases = [
 {id:1,surface:'creation',source:'20句 #16 + 变体1',text:'按文稿拆成4个图片镜头，保存分镜方案，先别生成。',kind:'propose'},
 {id:2,surface:'creation',source:'20句 #3',text:'第3镜改成夜景，其他镜头不动，保存到分镜方案。',kind:'night'},
 {id:3,surface:'creation',source:'20句 #13 + 变体2',text:'给小禾加一个文字人物锚点：短发、蓝色外套。让她出现的第1、3、4镜引用这个锚，保存方案，别生成图片。',kind:'anchor'},
 {id:4,surface:'creation',source:'20句 #8 + 变体3',text:'分镜第1镜改用 GPT Image 2 的1K档，保存方案，不生成。',kind:'model'},
 {id:5,surface:'creation',source:'20句 #5',text:'把所有镜头改成9:16竖屏，保存分镜方案。',kind:'portrait'},
 {id:6,surface:'generation',source:'20句 #16 + 变体4',text:'照文稿重新拆成4镜，保存一份分镜方案，先不生成媒体。',kind:'propose'},
 {id:7,surface:'generation',source:'20句 #3',text:'第3镜改成夜景，其他镜头不动，保存到分镜方案。',kind:'night'},
 {id:8,surface:'generation',source:'20句 #13 + 变体2',text:'给小禾加一个文字人物锚点：短发、蓝色外套。让她出现的第1、3、4镜引用这个锚，保存方案，别生成图片。',kind:'anchor'},
 {id:9,surface:'generation',source:'20句 #8 + 变体5',text:'第1镜用 GPT Image 2 的2K档，其余镜头不动，保存方案，不生成。',kind:'model2'},
 {id:10,surface:'generation',source:'20句 #5',text:'把所有镜头改成9:16竖屏，保存分镜方案。',kind:'portrait'},
];
export const plan = {operation:'propose_storyboard_plan',title:'日落前的一分钟',anchors:[],shots:['小禾带相机走进老街','老周在蓝布棚下抚平小鞋','针线穿过皮面特写','小禾点头致谢合上电脑'].map((prompt,i)=>({index:i+1,shotKind:'image',durationSec:0,anchorIds:[],prompt}))};
export function argsFor(c){
 if(c.kind==='propose')return globalThis.structuredClone(plan);
 if(c.kind==='night')return {operation:'patch_shots',select:{kind:'indexes',indexes:[3]},patch:{prompt:'夜景，暖黄灯泡照着针线穿过皮面的特写'}};
 if(c.kind==='portrait')return {operation:'patch_shots',select:{kind:'all'},patch:{aspectRatio:'9:16'}};
 const next=globalThis.structuredClone(plan);next.shots[2].prompt='夜景，暖黄灯泡照着针线穿过皮面的特写';next.anchors=[{id:'xiaohe',kind:'character',name:'小禾',description:'短发、蓝色外套',carrier:'text',scope:'selective'}];for(const n of [0,2,3])next.shots[n].anchorIds=['xiaohe'];
 if(c.kind.startsWith('model'))Object.assign(next.shots[0],{modelKey:'gpt-image-2',params:{size:c.kind==='model2'?'2K':'1K'}});
 return next;
}

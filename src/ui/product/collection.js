// Display state only. Source controllers continue to own records and actions.
export const DATA_PAGE_SIZE=20;
const normalize=value=>String(value ?? '').normalize('NFKC').toLocaleLowerCase().trim();
export function matchingRows(rows,query='',filters={}) {
  const terms=normalize(query).split(/\s+/u).filter(Boolean);
  return rows.flatMap((row,index)=>{
    const text=normalize(row.join(' '));
    return terms.every(term=>text.includes(term)) && Object.entries(filters).every(([column,value])=>!value || row[column]===value) ? [index] : [];
  });
}
export function categoryFilters(headers,rows,filters={}) {
  return headers.flatMap((label,column)=>{
    if(!/(状态|结果|类型|分类|类别|阵营|阶段|来源)/u.test(label))return [];
    const selected=filters[column],values=[...new Set([selected,...rows.map(row=>row[column])].filter(Boolean))];
    const finite=values.length<=8 && values.every(value=>value.length<=32);
    // Keep an applied choice visible when live data no longer contains it.
    return selected || values.length>=2 && finite ? [{label,column,values:finite ? values : [selected]}] : [];
  });
}
export function recordText(node) {
  if(node.kind==='text')return node.text;
  if(node.kind==='field')return node.type==='password' ? '' : `${node.label} ${node.value}`;
  return [node.text,node.label,...(node.children || []).map(recordText)].filter(Boolean).join(' ');
}

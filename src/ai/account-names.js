// These are display placeholders, never evidence that two accounts are equal.
export const isMaskedName=value=>/^(?:神秘人|神秘用户|匿名用户|匿名观众|隐身用户|隐藏用户)(?:[\s\d_*＊·.（）()号-]*)$|[*＊]{2,}/u.test(value || '');
export function preferAccountName(current,next){
 if(!next || next==='主播')return false;
 return !current || current==='主播' || !isMaskedName(next) || isMaskedName(current);
}

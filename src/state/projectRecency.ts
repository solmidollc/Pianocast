export interface ProjectActivity { updatedAt:string; lastOpenedAt?:string }
export const projectRecency=(project:ProjectActivity)=>project.lastOpenedAt??project.updatedAt;
export const mostRecentFirst=(a:ProjectActivity,b:ProjectActivity)=>Date.parse(projectRecency(b))-Date.parse(projectRecency(a));
export function formatProjectRecency(timestamp:string,now=new Date()) {
 const date=new Date(timestamp);
 if(date.toDateString()===now.toDateString())return `Today, ${date.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit',second:'2-digit'})}`;
 return date.toLocaleDateString(undefined,{month:'short',day:'numeric',...(date.getFullYear()!==now.getFullYear()?{year:'numeric'} as const:{})});
}

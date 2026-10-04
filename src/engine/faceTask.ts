/** MediaPipe clears its global factory after creating a task. Restore it for each attempt. */
export async function createFaceTask<T>(create:(delegate:'GPU'|'CPU')=>Promise<T>, restoreFactory:()=>void):Promise<{task:T;delegate:'GPU'|'CPU';gpuFailure?:string}> {
  restoreFactory();
  try {return {task:await create('GPU'),delegate:'GPU'};}
  catch(error) {
    const gpuFailure=error instanceof Error?error.message:String(error);
    restoreFactory();
    return {task:await create('CPU'),delegate:'CPU',gpuFailure};
  }
}

/** Ignore the cold compilation call, then require bounded consecutive steady measurements. */
export function measureFaceWarmup(detect:(timestamp:number)=>void, now:()=>number, budgetMs:number):{samples:number[];steadyMs:number} {
  detect(0);
  const samples:number[]=[];
  let consecutive=0;
  for(let index=1;index<=4;index++){
    const started=now();detect(index);const duration=now()-started;samples.push(duration);
    consecutive=duration<=budgetMs?consecutive+1:0;
    if(consecutive>=2)return {samples,steadyMs:Math.max(...samples.slice(-2))};
  }
  throw new Error(`warm-up exceeds freshness budget (${samples.map(n=>Math.round(n)).join(', ')} ms)`);
}

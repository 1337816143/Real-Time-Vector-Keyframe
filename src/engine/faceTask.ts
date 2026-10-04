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

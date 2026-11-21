import type { Locale } from '@/types/api';

export type TtsPreviewOptions={locale:Locale;speed:number;voice:string};
export interface PreviewHandle { pause():void; resume():void; stop():void }
export interface TextToSpeechService { createPreview(text:string,options:TtsPreviewOptions,onEnded:()=>void):PreviewHandle }

export class StaticTextToSpeech implements TextToSpeechService {
  createPreview(text:string,options:TtsPreviewOptions,onEnded:()=>void):PreviewHandle {
    const total=Math.max(1200,Math.min(12000,text.length*45/options.speed));let remaining=total;let started=Date.now();let timer:ReturnType<typeof setTimeout>|null=null;let stopped=false;
    const finish=()=>{timer=null;if(!stopped)onEnded();};
    const resume=()=>{if(stopped||timer)return;started=Date.now();timer=setTimeout(finish,remaining);};
    resume();
    return {pause(){if(timer){clearTimeout(timer);timer=null;remaining=Math.max(0,remaining-(Date.now()-started));}},resume,stop(){stopped=true;if(timer)clearTimeout(timer);timer=null;}};
  }
}
export const textToSpeechService:TextToSpeechService=new StaticTextToSpeech();

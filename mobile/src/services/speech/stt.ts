import type { Locale } from '@/types/api';

export interface SpeechToTextService {
  startDemo(locale:Locale):Promise<string|null>;
  stop():void;
}

const examples:Record<Locale,string>={en:'This is a sample transcript for demonstration. Real speech recognition is not connected.',fr:'Ceci est un exemple de transcription. La reconnaissance vocale réelle n’est pas connectée.',ar:'هذا نص تجريبي للعرض. لم يتم ربط التعرف الحقيقي على الكلام.'};
export class StaticSpeechToText implements SpeechToTextService {
  private timer:ReturnType<typeof setTimeout>|null=null;
  private finish:((value:string|null)=>void)|null=null;
  startDemo(locale:Locale){this.stop();return new Promise<string|null>(resolve=>{this.finish=resolve;this.timer=setTimeout(()=>{this.timer=null;this.finish=null;resolve(examples[locale]);},2200);});}
  stop(){if(this.timer){clearTimeout(this.timer);this.timer=null;}const finish=this.finish;this.finish=null;finish?.(null);}
}
export const speechToTextService:SpeechToTextService=new StaticSpeechToText();

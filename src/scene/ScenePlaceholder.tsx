import { SCENE_PANEL_BACKGROUND } from './appearance';

export function ScenePlaceholder({label,detail,labelClassName=''}:{label:string;detail?:string;labelClassName?:string}) {
  return <div className="scene-placeholder absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none" style={{background:SCENE_PANEL_BACKGROUND}}>
    <div className={'scene-empty-label '+labelClassName}>{label}</div>
    {detail&&<div className="scene-empty-detail">{detail}</div>}
  </div>;
}

import {render as settingsRender,action,submit,change,mounted} from './settings.js';
export {action,submit,change,mounted};
export function render(state){if(!state.me?.isAdmin)return '<div class="panel"><h1>Administrator access required</h1><a class="btn" href="#/settings">Open your settings</a></div>';return settingsRender(state,new URLSearchParams('admin=1'));}

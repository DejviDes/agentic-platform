// Shared UI state: active scene, city, selected agent, filter, district and selection in Home.
// Anyone can read it directly (ES module imports are live bindings), change it only via set({ … }),
// because another module can't assign to an imported variable.
export let active = null, city = null, filter = 'all', selectedAgent = null, hover = null;
export let focusConv = false; // focus mode of an open conversation (conversations.js): the scene behind it is not drawn
export let DISTRICT = 'city', homeModule = null, houseTab = 'overview', houseAgent = null, houseBack = null; // houseBack: building where "←" leads after a click-through from a My house card
export let filePreview = null; // file preview beside the chat (file-view.js): null or { path, base }
export let workroom = false; // Workroom work mode (workroom.js, UX audit wave 3): list | chat | mini state, 3D is not drawn
export function setState(z) {
  for (const [k, v] of Object.entries(z)) {
    switch (k) {
      case 'active': active = v; break;
      case 'city': city = v; break;
      case 'filter': filter = v; break;
      case 'selectedAgent': selectedAgent = v; break;
      case 'hover': hover = v; break;
      case 'DISTRICT': DISTRICT = v; break;
      case 'focusConv': focusConv = v; break;
      case 'homeModule': homeModule = v; break;
      case 'houseTab': houseTab = v; break;
      case 'houseAgent': houseAgent = v; break;
      case 'houseBack': houseBack = v; break;
      case 'filePreview': filePreview = v; break;
      case 'workroom': workroom = v; break;
      default: throw new Error(`stav: neznáma premenná ${k}`);
    }
  }
}

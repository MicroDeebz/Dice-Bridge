import { installReceiver } from "./receiver.js";
import { mountPopover } from "./ui.js";

const page = document.body.dataset.page;

installReceiver();
if (page === "popover") mountPopover();

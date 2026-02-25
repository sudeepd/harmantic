import { Recorder } from "../../src/recorder";
import { renderPanel } from "../../src/ui";

const recorder = new Recorder();

document.addEventListener("DOMContentLoaded", () => {
  renderPanel(document.getElementById("app")!, recorder);
});

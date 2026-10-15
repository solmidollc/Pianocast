/** Shared instructions for home and editor. Keep these aligned with actual controls. */
export function GettingStarted() {
  return <div className="getting-started">
    <p>Combine camera views, sheet music and live MIDI notation in one scene.</p>
    <ol>
      <li><h3>Choose your scenes</h3><p>Select one or more layouts, then create a project. Use the + below the canvas to add more scenes.</p></li>
      <li><h3>Connect your equipment</h3><p>Select a camera layer to choose its source in Video. Choose your keyboard under MIDI Input. Open Audio to select a microphone and check its recording level.</p></li>
      <li><h3>Add your music</h3><p>Select an Annotation layer to upload a PDF or connect a tablet for drawing. Use Layers to select elements and Properties to adjust them on smaller screens.</p></li>
      <li><h3>Record or share</h3><p>Record saves the composed scene and enabled audio. Stop ends the recording and saves the file. Livestream shows a clean view for sharing this browser tab through Zoom or another video-call app. Press Esc to return to editing.</p></li>
    </ol>
    <p className="getting-started-storage">Projects save automatically in this browser on this device. They do not sync between devices. Keep downloaded recordings separately.</p>
  </div>;
}

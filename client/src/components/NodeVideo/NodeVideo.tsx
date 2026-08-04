import ReactPlayer from "react-player";

import "./NodeVideo.scss";

/**
 * Renders a video player for the given URL.
 */
export function NodeVideo({ url }: { url: string }) {
  return (
    <div className="node-video">
      <div className="node-video__wrapper">
        <ReactPlayer
          // Works with YouTube, Vimeo, Twitch, SoundCloud, or direct MP4 links
          src={url}
          controls={true}
          width="100%"
          height="100%"
          className="node-video__wrapper__player"
        />
      </div>
    </div>
  );
}

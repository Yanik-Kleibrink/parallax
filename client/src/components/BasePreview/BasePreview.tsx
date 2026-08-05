import type { Base } from "@/models";
import { BaseAutoIcon } from "@/components";
import { removeBase } from "@/providers";

import { useNavigate } from "react-router";
import { ArrowRepeat, Trash } from "react-bootstrap-icons";

import "./BasePreview.scss";

export function BasePreview({
  base,
  onRemove,
}: {
  base: Base;
  onRemove: () => void;
}) {
  const navigate = useNavigate();
  return (
    <div
      className="base-preview"
      onClick={() => {
        navigate(`/${base.name}`);
      }}
    >
      <div className="base-preview__icon">
        <BaseAutoIcon baseName={base.name} />
      </div>
      <div className="base-preview__information">
        <div className="base-preview__information__header">
          <span className="base-preview__information__header__name">
            {base ? base.name : "No Base Selected"}
          </span>
          {"\u00A0"}
          <span className="base-preview__information__header__group">
            {base ? `(${base.group})` : "No Group"}
          </span>
        </div>
        <div className="base-preview__information__url">
          {base.tls
            ? `https://${base.domain}:${base.port}`
            : `http://${base.domain}:${base.port}`}
        </div>
      </div>
      <button
        className="base-preview__reconnect button button--square"
        onClick={(event) => {
          event.stopPropagation();
          navigate(`/${base.name}/reconnect`);
        }}
      >
        <ArrowRepeat />
      </button>
      <button
        className="base-preview__delete button button--square"
        onClick={(event) => {
          event.stopPropagation();
          removeBase(base.name)
            .then(onRemove)
            .catch((err) => {
              console.error(err);
              alert("Could not remove base!");
            });
        }}
      >
        <Trash />
      </button>
    </div>
  );
}

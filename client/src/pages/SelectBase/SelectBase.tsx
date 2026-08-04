import { BasePreview } from "@/components";
import { getBases } from "@/providers";

import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import type { Base } from "@/models";
import { Plus } from "react-bootstrap-icons";

import "./SelectBase.scss";

export default function SelectBase() {
  const [bases, setBases] = useState<Base[]>([]);

  useEffect(() => {
    const fetchExistingNames = async () => {
      // Fetch existing base names from your API or state management
      const bases = await getBases();
      bases.sort((a, b) => b.lastConnected - a.lastConnected);
      setBases(bases);
    };
    fetchExistingNames();
  }, [setBases]);

  const navigate = useNavigate();

  return (
    <div className="select-base__container">
      <div className="select-base__wrapper">
        <div className="select-base">
          <div className="select-base__header">
            <h1>Welcome!</h1>
          </div>
          <div className="select-base__bases">
            {bases.map((base) => (
              <BasePreview
                key={base.name}
                base={base}
                onRemove={() =>
                  setBases((bases) => {
                    const newBases = [...bases];
                    return newBases.filter((b) => b.name !== base.name);
                  })
                }
              />
            ))}
            <div className="select-base__bases__add-base">
              <button
                className="select-base__bases__add-base__button button button--round"
                onClick={() => {
                  navigate("/add");
                }}
              >
                <Plus />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

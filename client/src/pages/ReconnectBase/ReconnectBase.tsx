import { RetrieveBaseTokenForm } from "@/components";
import { type Base } from "@/models";
import { getBase } from "@/providers";

import { ArrowRepeat } from "react-bootstrap-icons";
import { useParams } from "react-router";
import { useEffect, useState } from "react";

import "./ReconnectBase.scss";

/**
 * ReconnectBase component provides a user interface for reconnecting to an existing base.
 *
 * It becomes necessary when the token expires.
 */
export default function ReconnectBase() {
  const { base } = useParams<{ base: string }>();

  const [baseObject, setBaseObject] = useState<Base | undefined>(undefined);

  useEffect(() => {
    const fetchBase = async () => {
      // Fetch the base information from your API or state management
      const fetchedBase = await getBase(base!);

      setBaseObject(fetchedBase);
    };
    fetchBase();
  }, [base]);

  return (
    <div className="form-container__container">
      <div className="form-container__wrapper">
        <div className="form-container">
          <div className="form-container__header">
            <div className="form-container__header__icon">
              <ArrowRepeat />
            </div>
            <div className="form-container__header__title">
              <h3>Reconnect to Base</h3>
            </div>
          </div>

          <RetrieveBaseTokenForm base={baseObject} />
        </div>
      </div>
    </div>
  );
}

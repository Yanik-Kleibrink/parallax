import { RetrieveBaseTokenForm } from "@/components";
import { CloudPlus } from "react-bootstrap-icons";

import "./AddBase.scss";

/**
 * AddBase component provides a user interface for connecting to a new base. It includes a header with an icon and title, and a form for retrieving the base token.
 */
export default function AddBase() {
  return (
    <div className="form-container__container">
      <div className="form-container__wrapper">
        <div className="form-container">
          <div className="form-container__header">
            <div className="form-container__header__icon">
              <CloudPlus />
            </div>
            <div className="form-container__header__title">
              <h3>Connect to a Base</h3>
            </div>
          </div>

          <RetrieveBaseTokenForm />
        </div>
      </div>
    </div>
  );
}

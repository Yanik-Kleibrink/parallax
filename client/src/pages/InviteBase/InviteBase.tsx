import { BaseInviteForm } from "@/components";
import { EnvelopeOpen } from "react-bootstrap-icons";

import "./InviteBase.scss";

/**
 * InviteBase component provides a user interface for inviting a friend to join a base.
 *
 * It works by displaying a token that can be used by the user in the add base form.
 */
export default function InviteBase() {
  return (
    <div className="form-container__container">
      <div className="form-container__wrapper">
        <div className="form-container">
          <div className="form-container__header">
            <div className="form-container__header__icon">
              <EnvelopeOpen />
            </div>
            <div className="form-container__header__title">
              <h3>Invite a Friend</h3>
            </div>
          </div>

          <BaseInviteForm />
        </div>
      </div>
    </div>
  );
}

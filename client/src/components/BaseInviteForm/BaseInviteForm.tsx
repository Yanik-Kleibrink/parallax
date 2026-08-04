import { BaseManagerContext } from "@/providers";
import type { Base } from "@/models";

import { useForm, type SubmitHandler } from "react-hook-form";
import { useState } from "react";
import { Send } from "react-bootstrap-icons";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useContext } from "react";

import "./BaseInviteForm.scss";

/**
 * A mapping of duration strings to their corresponding values in seconds. This is used to convert user-friendly duration inputs into a format that can be processed by the backend.
 */
const durationMap = {
  "1d": 60 * 60 * 24,
  "1w": 60 * 60 * 24 * 7,
  "1m": 60 * 60 * 24 * 30,
  "6m": 60 * 60 * 24 * 30 * 6,
} as const;

/**
 * The schema for validating the invite form inputs. It ensures that the group name is non-empty and contains only letters, and that the expiration time is a positive number.
 */
const schema = z.object({
  group: z
    .string()
    .min(1, "Group is required")
    .regex(/^[A-Za-z]+$/, "Group must contain only letters"),
  // The maximum length of time that the user can login to the base before needing to request a new invite from a wheel user.
  duration: z.preprocess(
    (value) => {
      if (value === "") return undefined; // triggers required error
      return durationMap[value as keyof typeof durationMap];
    },
    z.number({
      error: "Please select a duration",
    })
  ),
});
type InviteBaseForm = z.output<typeof schema>;
type InviteBaseFormValues = z.input<typeof schema>;

/**
 * This is the form for obtaining a token which which another user can obtain access to the base.
 */
export function BaseInviteForm() {
  // The token with which the user can login.
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [base, setBase] = useState<Base | null>(null);

  const baseManager = useContext(BaseManagerContext);

  useEffect(() => {
    if (!baseManager) return;

    setBase(baseManager.getBase());
  }, [baseManager]);

  const {
    register,
    handleSubmit,
    formState: { errors, touchedFields },
  } = useForm<InviteBaseFormValues, undefined, InviteBaseForm>({
    resolver: zodResolver(schema),
    mode: "onTouched",
  });

  const onSubmit: SubmitHandler<InviteBaseForm> = async (data) => {
    if (!base) {
      console.error("No base selected");
      return;
    }

    const url = `http${base.tls ? "s" : ""}://${base.domain}:${base.port}/grant`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        group: data.group,
        duration: data.duration,
      }),
      credentials: "include",
    });

    if (!response.ok) {
      console.error(`Request failed: ${response.status}`);
      return;
    }

    const token = await response.json();
    setInviteToken(token.toUpperCase());

    // Set token expiration to 10min.
    setTimeout(
      () => {
        setInviteToken(null);
      },
      10 * 60 * 1000
    );
    console.log(data);
  };

  return (
    <form className="form" onSubmit={handleSubmit(onSubmit)}>
      <div className="form__field">
        <label htmlFor="group" className="form__field__label">
          Group
        </label>
        <input
          id="group"
          className={`form__field__input ${
            errors.group
              ? "form__field__input--error"
              : touchedFields.group
                ? "form__field__input--success"
                : ""
          }`}
          placeholder="local"
          disabled={inviteToken !== null}
          {...register("group")}
        />
        {errors.group && (
          <span className="form__field__error">{errors.group.message}</span>
        )}
      </div>
      <div className="form__field">
        <label htmlFor="duration">Duration</label>

        <select
          className={`form__field__select ${
            errors.duration ? "form__field__select--error" : ""
          }`}
          id="duration"
          {...register("duration")}
          disabled={inviteToken !== null}
        >
          <option value="" disabled>
            Select a Duration
          </option>
          <option value="1d">One Day</option>
          <option value="1w">One Week</option>
          <option value="1m">One Month</option>
          <option value="6m">Six Months</option>
        </select>
        {errors.duration && (
          <span className="form__field__error">{errors.duration.message}</span>
        )}
      </div>
      {inviteToken === null && (
        <button
          className="retrieve-base-token-form__submit form__submit button button--square"
          type="submit"
        >
          <Send />
        </button>
      )}
      {inviteToken !== null && (
        <>
          <div className="form__token">
            <div className="form__token__start">
              {[...inviteToken].slice(0, 4).map((slot, idx) => (
                <div key={idx} className="form__token__slot">
                  {slot}
                </div>
              ))}
            </div>

            <div className="form__token__end">
              {[...inviteToken].slice(4).map((slot, idx) => (
                <div key={idx} className="form__token__slot">
                  {slot}
                </div>
              ))}
            </div>
          </div>
          <span className="base-invite__token__info">
            This token will expire in 10 minutes. Please share it with the user
            you want to invite.
          </span>
        </>
      )}
    </form>
  );
}

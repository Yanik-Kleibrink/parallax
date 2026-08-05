import { getBases, addBase } from "@/providers";
import { type Base } from "@/models";

import { OTPInput } from "input-otp";
import { useForm, type SubmitHandler, Controller } from "react-hook-form";
import { useState } from "react";
import { Send } from "react-bootstrap-icons";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useMemo } from "react";
import type { SlotProps } from "input-otp";
import { useNavigate } from "react-router";

import "./RetrieveBaseTokenForm.scss";

/**
 * Creates a Od schema for validating the form inputs. It checks for existing base names to ensure uniqueness.
 *
 * @param existingNames the names of the existing bases
 * @param baseName the name of the current base in case this is an edit form.
 *                 Here it is expected that the name coincides with the current baseName.
 */
const createSchema = (existingNames: string[], baseName?: string) =>
  z.object({
    name: z
      .string()
      .min(1, "Name is required")
      .regex(/^[A-Za-z]+$/, "Name must contain only letters")
      .refine(
        (name) =>
          baseName === name || (!baseName && !existingNames.includes(name)),
        "A base with this name already exists"
      ),
    domain: z.string().min(1, "Domain is required"),
    port: z.coerce
      .number("Port must be a number")
      .min(1, "Port must be greater than 0"),
    tls: z.coerce.boolean(),
    token: z
      .string()
      .regex(/^[A-Za-z]{8}$/, "Token must be exactly 8 letters")
      .optional()
      .or(z.literal("")),
  });
type AddBaseFormValues = z.input<ReturnType<typeof createSchema>>;
type AddBaseForm = z.output<ReturnType<typeof createSchema>>;

/**
 * A normal slot component for the OTP input. It displays a character if present, or a fake caret if it's the current input position.
 */
function Slot(props: SlotProps) {
  return (
    <>
      {props.hasFakeCaret ? (
        <FakeCaret />
      ) : (
        <div className="form__token__slot">
          {props.char !== null && <div>{props.char}</div>}
        </div>
      )}
    </>
  );
}

/**
 * A fake caret component to indicate the current input position in the OTP input.
 */
function FakeCaret() {
  return <div className="form__token__slot form__token__slot--active"></div>;
}

/**
 * This is the form for obtaining a token for a base.
 */
export function RetrieveBaseTokenForm({ base }: { base?: Base }) {
  const [existingNames, setExistingNames] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const navigate = useNavigate();

  useEffect(() => {
    const fetchExistingNames = async () => {
      // Fetch existing base names from your API or state management
      const bases = await getBases();
      const names = bases.map((base) => base.name);
      setExistingNames(names);
    };
    fetchExistingNames();
  }, []);

  const schema = useMemo(
    () => createSchema(existingNames, base?.name),
    [existingNames, base]
  );

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, touchedFields, isValid },
    reset,
  } = useForm<AddBaseFormValues, undefined, AddBaseForm>({
    resolver: zodResolver(schema),
    mode: "onTouched",
  });

  useEffect(() => {
    if (base) {
      reset({
        name: base.name,
        domain: base.domain,
        port: base.port,
        tls: base.tls,
        token: "",
      });
    }
  }, [base, reset]);

  const onSubmit: SubmitHandler<AddBaseForm> = async (data: AddBaseForm) => {
    console.log(data);
    const { token, ...props } = data;

    let group = null;
    let jwt = null;

    if (token) {
      const url = `http${data.tls ? "s" : ""}://${data.domain}:${data.port}/access/${data.token}`;
      const response = await fetch(url, {
        method: "GET",
        credentials: "include",
      });

      if (!response.ok) {
        console.error(`Request failed: ${response.status}`);
        setError(`Request failed.`);
      }

      let json = await response.json();
      group = json.group;
      jwt = json.jwt;
    } else {
      if (data.domain !== "localhost") {
        group = "public";
      } else {
        group = "wheel";
      }
    }
    addBase({
      ...props,
      group,
      lastConnected: Date.now(),
      configHash: 0,
      jwt,
    });

    if (!base) {
      navigate("/");
    } else {
      navigate(`/${base.name}`);
    }
  };
  return (
    <form className="form" onSubmit={handleSubmit(onSubmit)}>
      <div className="form__field">
        <label htmlFor="name" className="form__field__label">
          Name
        </label>
        <input
          id="name"
          className={`form__field__input ${
            errors.name
              ? "form__field__input--error"
              : touchedFields.name
                ? "form__field__input--success"
                : ""
          }`}
          placeholder="local"
          disabled={!!base}
          {...register("name")}
        />
        {errors.name && (
          <span className="form__field__error"> {errors.name.message}</span>
        )}
      </div>
      <div className="form__field">
        <label htmlFor="domain" className="form__field__label">
          Domain
        </label>
        <input
          id="domain"
          className={`form__field__input ${
            errors.domain
              ? "form__field__input--error"
              : touchedFields.name
                ? "form__field__input--success"
                : ""
          }`}
          placeholder="localhost"
          disabled={!!base}
          {...register("domain")}
        />
        {errors.domain && (
          <span className="form__field__error"> {errors.domain.message}</span>
        )}
      </div>
      <div className="form__field">
        <label htmlFor="port" className="form__field__label">
          Port
        </label>
        <input
          id="port"
          type="number"
          className={`form__field__input ${
            errors.port
              ? "form__field__input--error"
              : touchedFields.port
                ? "form__field__input--success"
                : ""
          }`}
          placeholder="30300"
          disabled={!!base}
          {...register("port")}
        />
        {errors.port && (
          <span className="form__field__error"> {errors.port.message}</span>
        )}
      </div>
      <label className="form__checkbox">
        <input type="checkbox" {...register("tls")} disabled={!!base} />
        <span className="form__checkmark"></span>
        <span>Use TLS</span>
      </label>
      <Controller
        name="token"
        control={control}
        render={({ field }) => (
          <OTPInput
            maxLength={8}
            pattern={"^[a-zA-Z]+$"}
            inputMode="text"
            value={field.value}
            onChange={(value) => {
              field.onChange(value.toUpperCase());
              field.onBlur();
            }}
            render={({ slots }) => (
              <div
                className={`form__token ${
                  touchedFields.token && !errors.token && field.value
                    ? "form__token--success"
                    : ""
                }`}
              >
                <div className="form__token__start">
                  {slots.slice(0, 4).map((slot, idx) => (
                    <Slot key={idx} {...slot} />
                  ))}
                </div>

                <div className="form__token__end">
                  {slots.slice(4).map((slot, idx) => (
                    <Slot key={idx} {...slot} />
                  ))}
                </div>
              </div>
            )}
          />
        )}
      />
      <div className="form__field__note">
        <span>
          No token is required when connecting to localhost or to a base with
          the group public.
        </span>
      </div>
      <button
        className="form__submit button button--square"
        type="submit"
        disabled={!isValid}
      >
        <Send />

        {error ? (
          <span className="form__submit__error">{error}</span>
        ) : undefined}
      </button>
    </form>
  );
}

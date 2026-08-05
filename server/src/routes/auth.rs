use actix_web::{
    HttpResponse, Responder, cookie::Cookie, cookie::SameSite,
    error::ErrorUnauthorized, web,
};
use jsonwebtoken::{
    DecodingKey, EncodingKey, Header, Validation, decode, encode,
};
use moka::future::Cache;
use serde::{Deserialize, Serialize};
use time;
use tracing::info;

/// The request to generate a JWT.
#[derive(Deserialize, Clone, Debug)]
pub struct JWTRequest {
    /// The group to which the user is requesting access.
    group: String,

    /// The duration for which the JWT is valid.
    duration: usize,
}

/// The claim extracted from the JWT.
#[derive(Serialize, Deserialize, Debug)]
struct JWTClaim {
    /// The group to which the user is requesting access.
    group: String,

    /// The nonce to prevent replay attacks.
    nonce: String,

    /// The expiration time of the JWT.
    exp: usize,

    /// This indicates whether the JWT was directly passed to the
    /// client and not only stored in a secure http-only cookie.
    /// Due to tracking preventions secure http-only cookies do not
    /// work on Webkit.
    ///
    /// There exists a global setting in the server to allow insecure
    /// cookies for testing purposes.
    insecure: bool,
}

/// The verified claim extracted from the JWT.
pub struct VerifiedGroup {
    /// The group to which the user is requesting access.
    pub group: String,
}

/// This function generates a random nonce for the JWT.
pub fn generate_nonce() -> String {
    let bytes: [u8; 16] = rand::random();
    hex::encode(bytes)
}

/// This function generates a random 8-character code consisting of
/// lowercase letters.
///
/// It is later passed back to the client and used as a one-time
/// password (OTP) for accessing the server.
fn generate_code() -> String {
    (0..8)
        .map(|_| (b'a' + rand::random_range(0..26)) as char)
        .collect()
}

impl actix_web::FromRequest for VerifiedGroup {
    type Error = actix_web::Error;
    type Future = std::pin::Pin<
        Box<
            dyn std::future::Future<
                    Output = Result<Self, Self::Error>,
                >,
        >,
    >;

    /// This implements the FromRequest trait for VerifiedGroup,
    /// allowing it to be extracted from an HttpRequest.
    ///
    /// In general, users of the loopback address are granted access
    /// to the "wheel" group. Otherwise, the function checks for a JWT
    /// in the "access_token" cookie, decodes it, and verifies its
    /// expiration. If the token is valid, it returns the group from
    /// the claim; otherwise, it defaults to "public".
    fn from_request(
        req: &actix_web::HttpRequest,
        _: &mut actix_web::dev::Payload,
    ) -> Self::Future {
        // TODO: Error here.
        let secret = req
            .app_data::<web::Data<String>>()
            .expect("Secret not found")
            .clone();
        let insecure_tokens = req
            .app_data::<web::Data<bool>>()
            .expect("Insecure cookie setting not found")
            .clone();

        let req_clone = req.clone();

        Box::pin(async move {
            info!("Verifying group from request");

            // Check if the request came from the localhost. If so,
            // grant access to the "wheel" group.
            if let Some(peer_addr) = req_clone.peer_addr() {
                if peer_addr.ip().is_loopback() {
                    info!(
                        "Request from localhost, granting access to 'wheel' group"
                    );
                    return Ok(VerifiedGroup {
                        group: "wheel".into(),
                    });
                }
            }

            let mut token: Option<String> = None;

            // Check for the "access_token" cookie in the request.
            if let Some(cookie) = req_clone.cookie("access_token") {
                info!("Found access_token cookie");
                token = Some(cookie.value().to_string());
            }

            let insecure_tokens_enabled =
                *insecure_tokens.into_inner();

            if insecure_tokens_enabled {
                // Check for the "Authorization" header in the
                // request.
                if let Some(auth_header) =
                    req_clone.headers().get("Authorization")
                {
                    info!("Possible token in Authorization header");
                    if let Ok(auth_str) = auth_header.to_str() {
                        if auth_str.starts_with("Bearer ") {
                            token = Some(auth_str[7..].to_string());
                        }
                    }
                }

                // Check for Sec-WebSocket-Protocol header in the
                // request.
                if let Some(ws_header) =
                    req_clone.headers().get("Sec-WebSocket-Protocol")
                {
                    info!(
                        "Possible token in Sec-WebSocket-Protocol header"
                    );
                    if let Ok(ws_str) = ws_header.to_str() {
                        token = Some(ws_str.to_string());
                    }
                }
            }

            if let Some(token) = token {
                let decoded = decode::<JWTClaim>(
                    token,
                    &DecodingKey::from_secret(secret.as_bytes()),
                    &Validation::default(),
                )
                .map_err(|_| ErrorUnauthorized("Invalid token"))?;

                let claim = decoded.claims;

                if claim.insecure && !insecure_tokens_enabled {
                    return Err(ErrorUnauthorized(
                        "Insecure token usage is not allowed",
                    ));
                }

                info!(
                    group = claim.group.clone(),
                    expiration = claim.exp,
                    "Verified JWT claim"
                );

                Ok(VerifiedGroup { group: claim.group })
            } else {
                info!(
                    "No access_token cookie found, defaulting to 'public' group"
                );
                return Ok(VerifiedGroup {
                    group: "public".into(),
                });
            }
        })
    }
}

/// This endpoint is used to generate a one-time password (OTP) for
/// accessing the server.
#[actix_web::post("/grant")]
async fn grant_access(
    req: web::Json<JWTRequest>,
    token_cache: web::Data<Cache<String, JWTRequest>>,
    group: VerifiedGroup,
) -> impl Responder {
    if group.group != "wheel" {
        return HttpResponse::Unauthorized().finish();
    }

    let otp = generate_code();
    let jwt_request = req.into_inner();
    info!(
        otp,
        group = jwt_request.group,
        duration = jwt_request.duration,
        "Generated OTP"
    );

    token_cache.insert(otp.clone(), jwt_request).await;

    HttpResponse::Ok().json(otp)
}

/// The response returned by the /access endpoint, containing the
/// group and the JWT.
#[derive(Serialize, Deserialize)]
struct AccessResponse {
    group: String,
    jwt: Option<String>,
}

/// This endpoint is used to access the server with a one-time
/// password (OTP) generated by the /grant endpoint. It sets the
/// associated secure cookie.
#[actix_web::get("/access/{otp}")]
async fn access(
    otp: web::Path<String>,
    token_cache: web::Data<Cache<String, JWTRequest>>,
    secret: web::Data<String>,
    insecure_tokens: web::Data<bool>,
) -> impl Responder {
    let otp = otp.into_inner().to_lowercase();

    if let Some(req) = token_cache.remove(&otp).await {
        // Create a JWT claim with the group and nonce.
        let claim = JWTClaim {
            group: req.group.clone(),
            nonce: generate_nonce(),
            exp: (chrono::Utc::now()
                + chrono::Duration::seconds(req.duration as i64))
            .timestamp() as usize,
            insecure: false,
        };

        // Encode the claim into a JWT.
        let token = encode(
            &Header::default(),
            &claim,
            &EncodingKey::from_secret(secret.as_bytes()),
        )
        .unwrap();

        info!(
            group = req.group.clone(),
            duration = req.duration,
            "Generated JWT for access"
        );

        let insecure_jwt = if *insecure_tokens.into_inner() {
            let insecure_claim = JWTClaim {
                group: req.group.clone(),
                nonce: generate_nonce(),
                exp: (chrono::Utc::now()
                    + chrono::Duration::seconds(req.duration as i64))
                .timestamp() as usize,
                insecure: true,
            };

            Some(
                encode(
                    &Header::default(),
                    &insecure_claim,
                    &EncodingKey::from_secret(secret.as_bytes()),
                )
                .unwrap(),
            )
        } else {
            None
        };

        // Set the JWT as a cookie in the response.
        HttpResponse::Ok()
            .cookie(
                Cookie::build("access_token", token.clone())
                    .path("/")
                    .http_only(true)
                    .secure(true)
                    .max_age(time::Duration::seconds(
                        req.duration as i64,
                    ))
                    .same_site(SameSite::None)
                    .finish(),
            )
            .json(AccessResponse {
                group: req.group.clone(),
                jwt: insecure_jwt,
            })
    } else {
        info!(otp = otp, "Invalid OTP attempt");
        HttpResponse::Unauthorized().finish()
    }
}

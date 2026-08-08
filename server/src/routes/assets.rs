use crate::items_management::ItemDatabase;
use crate::routes::auth::VerifiedGroup;
use crate::routes::auth::generate_nonce;

use actix_files::NamedFile;
use actix_web::{
    HttpRequest, HttpResponse, Result,
    error::ErrorUnauthorized,
    get,
    http::header,
    http::header::{ContentDisposition, DispositionType},
    routes, web,
};
use jsonwebtoken::{
    DecodingKey, EncodingKey, Header, Validation, decode, encode,
};
use std::path::PathBuf;
use tracing::info;

/// The type of asset to be accessed. Can be either "pdf" or "html".
#[derive(
    serde::Deserialize, serde::Serialize, Debug, Clone, Copy,
)]
enum AssetType {
    #[serde(rename = "pdf")]
    Pdf,
    #[serde(rename = "html")]
    Html,
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
struct JWTAssetGrant {
    /// Key of the item to be accessed.
    name: String,

    /// The type of asset to be accessed. Can be either "pdf" or
    /// "html".
    asset_type: AssetType,

    /// The expiration time of the JWT.
    ///
    /// Here always set to 1 hour, but can be changed in the future
    /// if needed.
    exp: usize,

    /// A nonce to prevent replay attacks.
    nonce: String,
}

/// The components of the path for obtaining a JWT that attests access
/// to an asset. This is used to deserialize the path parameters for
/// the asset route.
#[derive(serde::Deserialize)]
struct AssetJWTGrantPath {
    /// Key of the item to be accessed.
    key: String,

    /// The type of asset to be accessed. Can be either "pdf" or
    /// "html".
    asset_type: AssetType,
}

// This is the endpoint for getting a jwt that attests access to an
// asset.
//
// The returned jwt can be used to access the asset under
// /asset/{jwt}/....
#[get("/items/{key}/{asset_type}")]
pub async fn grant_asset(
    path: web::Path<AssetJWTGrantPath>,
    group: VerifiedGroup,
    items: web::Data<ItemDatabase>,
    secret: web::Data<String>,
) -> Result<HttpResponse> {
    let AssetJWTGrantPath { key, asset_type } = path.into_inner();
    let group = group.group.clone();

    // Check if the group can access the asset.
    if !items.check_item_accessibility(&key, &group).await {
        return Ok(HttpResponse::Forbidden().body("Access denied"));
    }

    // Create a JWT that attests access to the asset.
    let jwt_claim = JWTAssetGrant {
        name: key,
        asset_type,
        nonce: generate_nonce(),
        exp: (chrono::Utc::now() + chrono::Duration::hours(1))
            .timestamp() as usize,
    };

    // Sign the JWT with the server's secret.
    let token = encode(
        &Header::default(),
        &jwt_claim,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .unwrap();

    Ok(HttpResponse::Ok().json(format!("/asset/{}", token)))
}

/// This struct is used to deserialize the path parameters for the
/// asset route.
#[derive(serde::Deserialize)]
struct AssetAccessPath {
    jwt: String,
    tail: Option<PathBuf>,
}

/// This is the endpoint for accessing an asset. It takes a JWT that
/// attests access to the asset and an optional tail path for HTML
/// assets. The JWT is verified and decoded, and if valid, the
/// requested asset is returned.
#[routes]
#[get("/asset/{jwt}/{tail:.*}")]
#[get("/asset/{jwt}")]
pub async fn access_asset(
    req: HttpRequest,
    path: web::Path<AssetAccessPath>,
    secret: web::Data<String>,
    items: web::Data<ItemDatabase>,
) -> Result<HttpResponse> {
    let AssetAccessPath { jwt, tail } = path.into_inner();

    // Decode the JWT and verify its signature.
    let decoded = decode::<JWTAssetGrant>(
        &jwt,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    )
    .map_err(|_| ErrorUnauthorized("Invalid token"))?;

    let claim = decoded.claims;

    info!(
        "Accessing asset: key={}, asset_type={:?}, exp={}, nonce={}",
        claim.name, claim.asset_type, claim.exp, claim.nonce
    );

    match (claim.asset_type, tail) {
        (AssetType::Pdf, None) => {
            if let Some(path) =
                items.retrieve_pdf_path(&claim.name, "wheel").await
            {
                let file = NamedFile::open(path)?
                    .set_content_disposition(ContentDisposition {
                        disposition: DispositionType::Inline,
                        parameters: vec![],
                    });

                // Convert into a response and remove the
                // Content-Encoding header.
                // Currently actix-file adds a content-encoding:
                // identity header, which is not allowed according to
                // the HTTP spec for inline content. This is a
                // workaround to remove that header.
                let mut response = file.into_response(&req);

                response
                    .headers_mut()
                    .remove(header::CONTENT_ENCODING);

                Ok(response)
            } else {
                Ok(HttpResponse::NotFound().body("PDF not found"))
            }
        }
        (AssetType::Html, tail) => {
            let tail =
                tail.unwrap_or_else(|| PathBuf::from("index.html"));

            // Access the HTML asset.
            if let Some(base_path) = items
                .retrieve_html_base_path(&claim.name, "wheel")
                .await
            {
                // Combine with tail and check that it is inside the
                // base path
                if let Some(path) =
                    base_path.join(&tail).canonicalize().ok()
                {
                    if !path.starts_with(&base_path) {
                        return Err(
                            actix_web::error::ErrorForbidden(
                                "Access denied",
                            ),
                        );
                    }

                    let file = NamedFile::open(path)?
                        .set_content_disposition(
                            ContentDisposition {
                                disposition: DispositionType::Inline,
                                parameters: vec![],
                            },
                        );

                    // Convert into a response and remove the
                    // Content-Encoding header.
                    // Currently actix-file adds a content-encoding:
                    // identity header, which is not allowed according
                    // to the HTTP spec for inline content. This is a
                    // workaround to remove that header.
                    let mut response = file.into_response(&req);

                    response
                        .headers_mut()
                        .remove(header::CONTENT_ENCODING);

                    Ok(response)
                } else {
                    Ok(HttpResponse::NotFound()
                        .body("HTML not found"))
                }
            } else {
                Ok(HttpResponse::NotFound().body("HTML not found"))
            }
        }
        _ => Ok(HttpResponse::BadRequest()
            .body("Invalid asset type or path")),
    }
}

use crate::items_management::{ItemChange, ItemDatabase};
use crate::models::item::{Item, ItemFreshness};
use crate::routes::auth::VerifiedGroup;

use actix_web::{Error, HttpRequest, HttpResponse, rt, web};
use actix_ws::AggregatedMessage;
use futures_util::future::Either;
use tokio_stream::StreamExt;
use tokio_stream::wrappers::BroadcastStream;
use tracing::{debug, error, info, info_span};

/// This is the type returned to the client.
#[derive(Debug, serde::Serialize)]
enum ItemInformation {
    Update(Item),
    Remove(String),

    /// The second component is the config hash.
    Inventory(Vec<ItemFreshness>, u64),
}

pub async fn new_websocket(
    req: HttpRequest,
    items: web::Data<ItemDatabase>,
    config_hash: web::Data<u64>,
    stream: web::Payload,
    group: VerifiedGroup,
) -> Result<HttpResponse, Error> {
    let (res, mut session, stream) = actix_ws::handle(&req, stream)?;

    let sender = items.get_item_update_sender();
    let group = group.group;

    // Updates stream
    let updates_stream = BroadcastStream::new(sender.subscribe())
        .filter_map(|res| res.ok()); // Should prevent the receiver from being overwhelmed.

    let mut stream = stream
        .aggregate_continuations()
        // aggregate continuation frames up to 1MiB
        .max_continuation_size(2_usize.pow(20))
        .map(Either::Left)
        .merge(updates_stream.map(Either::Right));

    // start task but don't wait for it
    rt::spawn(async move {
        // The server always sends the updates list first

        let item_information = ItemInformation::Inventory(
            items.item_updates(&group),
            *config_hash.into_inner(),
        );

        let json = serde_json::to_string(&item_information);
        match json {
            Ok(json) => {
                match session.text(json).await {
                    Ok(_) => {
                        info!(
                            "Sent status of items to newly connected client."
                        );
                    }
                    Err(e) => {
                        error!(
                            error=%e,
                            "Error sending inventory to client"
                        );
                    }
                };
            }
            Err(e) => {
                error!(
                    error=%e,
                    "Error serializing item information"
                );
            }
        }

        // receive messages from websocket
        while let Some(event) = stream.next().await {
            debug!(?event, "WebSocket event");
            match event {
                Either::Left(msg) => match msg {
                    Ok(AggregatedMessage::Text(name)) => {
                        let _ =
                            info_span!("Websocket Request", %name);

                        if let Some(item) =
                            items.retrieve_item(&name, &group).await
                        {
                            let item_information =
                                ItemInformation::Update(item);

                            let json = serde_json::to_string(
                                &item_information,
                            );
                            match json {
                                Ok(json) => {
                                    match session.text(json).await {
                                        Ok(_) => {
                                            info!(
                                                "Sent update to client."
                                            );
                                        }
                                        Err(e) => {
                                            error!(
                                                error=%e,
                                                "Error sending update to client"
                                            );
                                        }
                                    };
                                }
                                Err(e) => {
                                    error!(
                                        error=%e,
                                        "Error serializing item information"
                                    );
                                }
                            }
                        } else {
                            error!("Item not found.");
                        }
                    }

                    Ok(AggregatedMessage::Binary(bin)) => {
                        // echo binary message
                        match session.binary(bin).await {
                            Ok(_) => {
                                info!("Echoed binary message.");
                            }
                            Err(e) => {
                                error!(
                                    error=%e,
                                    "Error sending update to client"
                                );
                            }
                        }
                    }

                    Ok(AggregatedMessage::Ping(msg)) => {
                        // respond to PING frame with PONG frame
                        match session.pong(&msg).await {
                            Ok(_) => {
                                info!("Ponged.");
                            }
                            Err(e) => {
                                error!(
                                    error=%e,
                                    "Error sending update to client"
                                );
                            }
                        }
                    }

                    Ok(AggregatedMessage::Close(reason)) => {
                        // close connection
                        match session.close(reason).await {
                            Ok(_) => {
                                info!("Closed connection.");
                            }
                            Err(e) => {
                                error!(
                                    error=%e,
                                    "Error sending close to client"
                                );
                            }
                        }
                        break;
                    }

                    _ => {}
                },
                Either::Right(ItemChange::Update(name)) => {
                    // Push the newest version of name item to the
                    // client
                    let _ = info_span!("Websocket Push", name);

                    if let Some(item) =
                        items.retrieve_item(&name, &group).await
                    {
                        let item_information =
                            ItemInformation::Update(item);

                        let json =
                            serde_json::to_string(&item_information);
                        match json {
                            Ok(json) => {
                                match session.text(json).await {
                                    Ok(_) => {
                                        info!(
                                            "Sent update to client."
                                        );
                                    }
                                    Err(e) => {
                                        error!(
                                            error=%e,
                                            "Error sending update to client"
                                        );
                                    }
                                };
                            }
                            Err(e) => {
                                error!(
                                    error=%e,
                                    "Error serializing item information"
                                );
                            }
                        }
                    } else {
                        error!("Item not found.");
                    }
                }
                Either::Right(ItemChange::Remove(name)) => {
                    let _ = info_span!("Websocket Push", name);
                    let item_information =
                        ItemInformation::Remove(name);

                    let json =
                        serde_json::to_string(&item_information);
                    match json {
                        Ok(json) => {
                            match session.text(json).await {
                                Ok(_) => {
                                    info!("Sent update to client.");
                                }
                                Err(e) => {
                                    error!(
                                        error=%e,
                                        "Error sending update to client"
                                    );
                                }
                            };
                        }
                        Err(e) => {
                            error!(
                                error=%e,
                                "Error serializing item information"
                            );
                        }
                    }
                }
            }
        }
    });

    // respond immediately with response connected to WS session
    Ok(res)
}

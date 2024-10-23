// new image url : https://spdev.b-cdn.net/63f6df662640e1dc030591f2/product/dimsum_1677558350.jpg

exports = async ({ image_url }) => {
  try {
    const bunny_url = context.environment.values.BUNNY_URL;
    const bunny_url_purge = context.environment.values.BUNNY_URL_PURGE;
    const bunny_user = context.environment.values.BUNNY_USER;

    const path = image_url.split("/");

    const image =
      bunny_url +
      bunny_user +
      "/" +
      path.slice(path.length - 3, path.length).join("/");
    const purge_url =
      bunny_url_purge + encodeURIComponent(image_url) + "%2A&async=false";

    await context.http.get({
      url: purge_url,
      headers: {
        AccessKey: [context.environment.values.BUNNY_API_KEY],
      },
    });

    return await context.http.delete({
      url: image,
      headers: {
        AccessKey: [context.environment.values.BUNNY_ACCESS_KEY],
      },
    });
  } catch (e) {
    context.functions.execute("handleCatchError", e, "", "intRemoveImage");

    throw new Error(error.message);
  }
};

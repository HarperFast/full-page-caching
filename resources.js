import config from "./config.json" with { type: "json" };
// ***********EXAMPLE IMPLEMENTATION OF PAGE CACHE************ //

/*
	  Usage Instructions:
	  1. Configure the origin URL in the config.json file.
	  2. Define any additional headers, authorization, or other configurations in the fetch request to the origin
	  3. Include any additional logic to modify the response before sending to the client
 */

/**
 * Here we define the origin source for the page cache table, defining a get method that will be called when the
 * page is not found in the cache. This method fetches the page from the origin and returns the page content to be
 *  cached.
**/
tables.PageCache.sourcedFrom({
	// Fetch the page and update the cache
	async get(path) {
		const origin = config.origin.url; // get the origin URL from the config file
		const response = await fetch(new URL(path, origin)); // Fetch the page content

		const blob = await createBlob((await response.body));
		// this is the cached record to return and store in the cached table
		return {
			path,
			pageContents: blob
		};
	}
});

/**
 * Here we extend the PageCache table to specify exactly how we will return the cached page to the client.
 */
export class PageCache extends tables.PageCache {
	/**
	 * This method is called when a GET is made to the cache table for a page. This is called *after* the page has been
	 * retrieved from the cache or loaded from the origin. This method allows us to customize how the cached record
	 * should be return to the client. Here we want to specifically return the contents as HTML, rather than return an
	 * object structure (which would be serialized to JSON, by default).
	 * @return {{cachedData: *}}
	 */
	get() {
		this.getContext().sendEarlyHints('</styles.css>; rel=preload; as=style');
		return {
			contentType: 'text/html',
			data: this.pageContents,
		};
	}
}


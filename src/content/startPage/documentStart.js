import { getStartPage, isKnownPage, START_PAGE_ATTR, START_PAGE_HOME } from "./startPage.js";


getStartPage()
  .then((value) => {
    document.documentElement.setAttribute(
      START_PAGE_ATTR,
      isKnownPage(value) ? value : START_PAGE_HOME
    );
  })
  .catch(() => { });

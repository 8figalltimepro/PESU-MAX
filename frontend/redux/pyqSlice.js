import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import {
  fetchPyqCatalog,
  initializeLibraryLogin,
  loadMoreCoursePyqs,
  searchCoursePyqs,
  downloadCoursePyq,
  downloadSelectedCoursePyqsZip
} from "../../src/services/pyqService.js";
import {
  LIBRARY_MEMBER_ID_BASE64,
  LIBRARY_PASSWORD_BASE64
} from "../constants/constants.js";

const DEFAULT_PYQ_YEAR = String(new Date().getFullYear());
const SEARCH_CACHE_TTL_MS = 15 * 60 * 1000;

export const initLibraryAuth = createAsyncThunk(
  "pyq/initLibraryAuth",
  async (_, { rejectWithValue }) => {
    try {
      return await initializeLibraryLogin({
        encodedMemberId: LIBRARY_MEMBER_ID_BASE64,
        encodedPassword: LIBRARY_PASSWORD_BASE64
      });
    } catch (error) {
      return rejectWithValue(error.message);
    }
  }
);

export const loadPyqCatalog = createAsyncThunk(
  "pyq/loadPyqCatalog",
  async (_, { rejectWithValue }) => {
    try {
      return await fetchPyqCatalog();
    } catch (error) {
      return rejectWithValue(error.message);
    }
  }
);

export const searchPyqs = createAsyncThunk(
  "pyq/searchPyqs",
  async ({ query, year, force = false }, { getState, rejectWithValue }) => {
    const searchKey = `${query.trim().toLowerCase()}::${year || ""}`;
    const cachedSearch = getState().pyq?.cachedSearches?.[searchKey];

    if (
      !force
      && cachedSearch
      && Date.now() - (cachedSearch.cachedAt || 0) < SEARCH_CACHE_TTL_MS
    ) {
      return { cachedSearch, searchKey, fromCache: true };
    }

    try {
      const response = await searchCoursePyqs({
        query,
        year,
        encodedMemberId: LIBRARY_MEMBER_ID_BASE64,
        encodedPassword: LIBRARY_PASSWORD_BASE64
      });
      return { ...response, searchKey };
    } catch (error) {
      return rejectWithValue(error.message);
    }
  },
  {
    condition: (_, { getState }) => !getState().pyq?.searchLoading
  }
);

export const loadMorePyqs = createAsyncThunk(
  "pyq/loadMorePyqs",
  async (_, { getState, rejectWithValue }) => {
    const { pyq } = getState();
    const nextPageNumber = (pyq?.currentPage || 1) + 1;
    const activePage = pyq?.pagesByNumber?.[pyq.currentPage];

    if (pyq?.pagesByNumber?.[nextPageNumber]) {
      return { cachedPageNumber: nextPageNumber };
    }

    if (!activePage?.hasMore || !activePage?.nextPageCursor) {
      return rejectWithValue("No more PYQs to load");
    }

    try {
      const response = await loadMoreCoursePyqs({
        query: pyq.lastQuery,
        year: pyq.selectedYear,
        cursor: activePage.nextPageCursor,
        loadedCount: Object.values(pyq.pagesByNumber).reduce(
          (count, page) => count + (page.results?.length || 0),
          0
        ),
        encodedMemberId: LIBRARY_MEMBER_ID_BASE64,
        encodedPassword: LIBRARY_PASSWORD_BASE64
      });
      return { ...response, pageNumber: nextPageNumber };
    } catch (error) {
      return rejectWithValue(error.message);
    }
  },
  {
    condition: (_, { getState }) => {
      const pyq = getState().pyq;
      return !pyq?.loadingMore && !pyq?.searchLoading && !pyq?.bulkDownloading;
    }
  }
);

export const downloadPyq = createAsyncThunk(
  "pyq/downloadPyq",
  async ({ downloadPath, title, itemId }, { rejectWithValue }) => {
    try {
      const data = await downloadCoursePyq({
        downloadPath,
        title,
        encodedMemberId: LIBRARY_MEMBER_ID_BASE64,
        encodedPassword: LIBRARY_PASSWORD_BASE64
      });
      return { ...data, itemId };
    } catch (error) {
      return rejectWithValue(error.message);
    }
  }
);

export const downloadSelectedPyqsZip = createAsyncThunk(
  "pyq/downloadSelectedPyqsZip",
  async ({ items, query }, { rejectWithValue }) => {
    try {
      return await downloadSelectedCoursePyqsZip({
        items,
        query,
        encodedMemberId: LIBRARY_MEMBER_ID_BASE64,
        encodedPassword: LIBRARY_PASSWORD_BASE64
      });
    } catch (error) {
      return rejectWithValue(error.message);
    }
  }
);

const initialState = {
  semesters: [],
  courses: [],
  currentStep: "semesters",
  semesterFilter: "all",
  selectedSemester: null,
  selectedCourse: null,
  selectedPyqs: {},
  courseSearch: "",
  searchQuery: "",
  searchResults: [],
  currentPage: 1,
  pagesByNumber: {},
  activeSearchKey: "",
  cachedSearches: {},
  totalResults: 0,
  lastQuery: "",
  lastSearchYear: "",
  selectedYear: DEFAULT_PYQ_YEAR,
  hasMore: false,
  nextPageCursor: null,
  catalogLoading: false,
  authLoading: false,
  authReady: false,
  searchLoading: false,
  loadingMore: false,
  downloadingItemId: null,
  bulkDownloading: false,
  downloadSuccessItemId: null,
  bulkDownloadResult: null,
  error: null,
  authError: null,
  searchError: null,
  loadMoreError: null,
  downloadError: null,
  bulkDownloadError: null
};

const pyqSlice = createSlice({
  name: "pyq",
  initialState,
  reducers: {
    setCurrentStep: (state, action) => {
      state.currentStep = action.payload;
    },
    setSemesterFilter: (state, action) => {
      state.semesterFilter = action.payload;
    },
    setSelectedSemester: (state, action) => {
      state.selectedSemester = action.payload;
      state.selectedCourse = null;
      state.selectedPyqs = {};
      state.courseSearch = "";
      state.searchResults = [];
      state.currentPage = 1;
      state.pagesByNumber = {};
      state.activeSearchKey = "";
      state.totalResults = 0;
      state.lastQuery = "";
      state.lastSearchYear = "";
      state.selectedYear = DEFAULT_PYQ_YEAR;
      state.hasMore = false;
      state.nextPageCursor = null;
      state.searchQuery = "";
      state.searchError = null;
      state.loadMoreError = null;
    },
    setSelectedCourse: (state, action) => {
      state.selectedCourse = action.payload;
      state.selectedPyqs = {};
      state.searchQuery = action.payload?.subjectName || "";
      state.searchResults = [];
      state.currentPage = 1;
      state.pagesByNumber = {};
      state.activeSearchKey = "";
      state.totalResults = 0;
      state.lastQuery = "";
      state.lastSearchYear = "";
      state.selectedYear = DEFAULT_PYQ_YEAR;
      state.hasMore = false;
      state.nextPageCursor = null;
      state.searchError = null;
      state.loadMoreError = null;
      state.downloadSuccessItemId = null;
      state.downloadError = null;
      state.bulkDownloadResult = null;
      state.bulkDownloadError = null;
    },
    setCourseSearch: (state, action) => {
      state.courseSearch = action.payload;
    },
    setSearchQuery: (state, action) => {
      state.searchQuery = action.payload;
      state.searchError = null;
      state.loadMoreError = null;
      state.downloadSuccessItemId = null;
    },
    showPyqPage: (state, action) => {
      const pageNumber = action.payload;
      const page = state.pagesByNumber[pageNumber];
      if (!page) {
        return;
      }

      state.currentPage = pageNumber;
      state.searchResults = page.results || [];
      state.totalResults = page.totalResults || state.totalResults;
      state.hasMore = Boolean(page.hasMore);
      state.nextPageCursor = page.nextPageCursor || null;
      state.loadMoreError = null;
    },
    setSelectedYear: (state, action) => {
      state.selectedYear = action.payload;
      state.searchError = null;
      state.loadMoreError = null;
      state.downloadSuccessItemId = null;
    },
    togglePyqSelection: (state, action) => {
      const itemId = action.payload;
      if (state.selectedPyqs[itemId]) {
        delete state.selectedPyqs[itemId];
      } else {
        state.selectedPyqs[itemId] = true;
      }
      state.bulkDownloadResult = null;
      state.bulkDownloadError = null;
    },
    setSelectedPyqs: (state, action) => {
      state.selectedPyqs = action.payload || {};
      state.bulkDownloadResult = null;
      state.bulkDownloadError = null;
    },
    clearPyqSelection: (state) => {
      state.selectedPyqs = {};
    },
    clearDownloadFeedback: (state) => {
      state.downloadSuccessItemId = null;
      state.downloadError = null;
      state.bulkDownloadResult = null;
      state.bulkDownloadError = null;
    },
    resetPyqState: () => initialState
  },
  extraReducers: (builder) => {
    builder
      .addCase(initLibraryAuth.pending, (state) => {
        state.authLoading = true;
        state.authError = null;
      })
      .addCase(initLibraryAuth.fulfilled, (state) => {
        state.authLoading = false;
        state.authReady = true;
      })
      .addCase(initLibraryAuth.rejected, (state, action) => {
        state.authLoading = false;
        state.authReady = false;
        state.authError = action.payload;
      })
      .addCase(loadPyqCatalog.pending, (state) => {
        state.catalogLoading = true;
        state.error = null;
      })
      .addCase(loadPyqCatalog.fulfilled, (state, action) => {
        state.catalogLoading = false;
        state.semesters = action.payload?.semesters || [];
        state.courses = action.payload?.courses || [];

        const latestSemester = state.semesters.reduce((latest, semester) => {
          const semesterNumber = Number(semester.value);

          if (!Number.isFinite(semesterNumber)) {
            return latest;
          }

          return !latest || semesterNumber > Number(latest.value)
            ? semester
            : latest;
        }, null);

        state.semesterFilter = latestSemester?.value || "all";
      })
      .addCase(loadPyqCatalog.rejected, (state, action) => {
        state.catalogLoading = false;
        state.error = action.payload;
      })
      .addCase(searchPyqs.pending, (state) => {
        state.searchLoading = true;
        state.selectedPyqs = {};
        state.searchError = null;
        state.loadMoreError = null;
        state.hasMore = false;
        state.nextPageCursor = null;
        state.loadingMore = false;
        state.downloadSuccessItemId = null;
        state.bulkDownloadResult = null;
        state.bulkDownloadError = null;
      })
      .addCase(searchPyqs.fulfilled, (state, action) => {
        state.searchLoading = false;
        state.selectedPyqs = {};
        const cachedSearch = action.payload?.cachedSearch;

        if (cachedSearch) {
          state.pagesByNumber = cachedSearch.pagesByNumber;
          state.currentPage = 1;
          state.activeSearchKey = action.payload.searchKey;
          state.lastQuery = cachedSearch.query;
          state.lastSearchYear = cachedSearch.year;
          state.totalResults = cachedSearch.totalResults;
          const firstPage = cachedSearch.pagesByNumber[1];
          state.searchResults = firstPage?.results || [];
          state.hasMore = Boolean(firstPage?.hasMore);
          state.nextPageCursor = firstPage?.nextPageCursor || null;
        } else {
          const firstPage = {
            results: action.payload?.results || [],
            totalResults: action.payload?.totalResults || 0,
            hasMore: Boolean(action.payload?.hasMore),
            nextPageCursor: action.payload?.nextCursor || null
          };
          state.currentPage = 1;
          state.pagesByNumber = { 1: firstPage };
          state.activeSearchKey = action.payload?.searchKey || "";
          state.searchResults = firstPage.results;
          state.totalResults = firstPage.totalResults;
          state.lastQuery = action.payload?.query || "";
          state.lastSearchYear = action.meta.arg?.year || "";
          state.hasMore = firstPage.hasMore;
          state.nextPageCursor = firstPage.nextPageCursor;
          if (state.activeSearchKey) {
            state.cachedSearches[state.activeSearchKey] = {
              query: state.lastQuery,
              year: state.lastSearchYear,
              totalResults: state.totalResults,
              pagesByNumber: state.pagesByNumber,
              cachedAt: Date.now()
            };
          }
        }
        state.loadingMore = false;
        state.loadMoreError = null;
      })
      .addCase(searchPyqs.rejected, (state, action) => {
        state.searchLoading = false;
        state.selectedPyqs = {};
        state.searchResults = [];
        state.totalResults = 0;
        state.lastQuery = "";
        state.lastSearchYear = "";
        state.hasMore = false;
        state.nextPageCursor = null;
        state.loadingMore = false;
        state.loadMoreError = null;
        state.searchError = action.payload;
      })
      .addCase(loadMorePyqs.pending, (state) => {
        state.loadingMore = true;
        state.loadMoreError = null;
      })
      .addCase(loadMorePyqs.fulfilled, (state, action) => {
        state.loadingMore = false;
        const pageNumber = action.payload?.cachedPageNumber || action.payload?.pageNumber;
        if (!pageNumber) {
          return;
        }

        if (!action.payload?.cachedPageNumber) {
          state.pagesByNumber[pageNumber] = {
            results: action.payload?.results || [],
            totalResults: action.payload?.totalResults || state.totalResults,
            hasMore: Boolean(action.payload?.hasMore),
            nextPageCursor: action.payload?.nextCursor || null
          };
        }

        const page = state.pagesByNumber[pageNumber];
        state.currentPage = pageNumber;
        state.searchResults = page.results || [];
        state.totalResults = page.totalResults || state.totalResults;
        state.lastQuery = action.payload?.query || state.lastQuery;
        state.nextPageCursor = page.nextPageCursor || null;
        state.hasMore = Boolean(page.hasMore);
        if (state.activeSearchKey) {
          state.cachedSearches[state.activeSearchKey] = {
            query: state.lastQuery,
            year: state.lastSearchYear,
            totalResults: state.totalResults,
            pagesByNumber: state.pagesByNumber,
            cachedAt: Date.now()
          };
        }
        state.loadMoreError = null;
      })
      .addCase(loadMorePyqs.rejected, (state, action) => {
        state.loadingMore = false;
        state.loadMoreError = action.payload;
      })
      .addCase(downloadPyq.pending, (state, action) => {
        state.downloadingItemId = action.meta.arg?.itemId || null;
        state.downloadSuccessItemId = null;
        state.downloadError = null;
      })
      .addCase(downloadPyq.fulfilled, (state, action) => {
        state.downloadingItemId = null;
        state.downloadSuccessItemId = action.payload?.itemId || null;
      })
      .addCase(downloadPyq.rejected, (state, action) => {
        state.downloadingItemId = null;
        state.downloadError = action.payload;
      })
      .addCase(downloadSelectedPyqsZip.pending, (state) => {
        state.bulkDownloading = true;
        state.bulkDownloadResult = null;
        state.bulkDownloadError = null;
      })
      .addCase(downloadSelectedPyqsZip.fulfilled, (state, action) => {
        state.bulkDownloading = false;
        state.bulkDownloadResult = action.payload || null;
        state.bulkDownloadError = null;
      })
      .addCase(downloadSelectedPyqsZip.rejected, (state, action) => {
        state.bulkDownloading = false;
        state.bulkDownloadError = action.payload;
      });
  }
});

export const {
  setCurrentStep,
  setSemesterFilter,
  setSelectedSemester,
  setSelectedCourse,
  setSelectedYear,
  setCourseSearch,
  setSearchQuery,
  showPyqPage,
  togglePyqSelection,
  setSelectedPyqs,
  clearPyqSelection,
  clearDownloadFeedback,
  resetPyqState
} = pyqSlice.actions;

export default pyqSlice.reducer;

import { AniList } from '../providers/anilist.js';
import { AnimePahe } from '../providers/animepahe.js';

export async function mapAnilistToAnimePahe(anilistId) {
  const mapper = new AnimepaheMapper();
  return await mapper.mapAnilistToAnimePahe(anilistId);
}

export class AnimepaheMapper {
  constructor() {
    this.anilist = new AniList();
    this.animePahe = new AnimePahe();
  }

  async mapAnilistToAnimePahe(anilistId) {
    try {
      const animeInfo = await this.anilist.getAnimeInfo(parseInt(anilistId));

      if (!animeInfo) {
        throw new Error(`Anime with id ${anilistId} not found on AniList`);
      }

      const bestMatch = await this.findAnimePaheMatch(animeInfo);

      if (!bestMatch) {
        return {
          id: animeInfo.id,
          animepahe: null
        };
      }

      const episodeData = await this.getAnimePaheEpisodes(bestMatch);

      return {
        id: animeInfo.id,
        animepahe: {
          id: bestMatch.id,
          title: bestMatch.title || bestMatch.name,
          episodes: episodeData.episodes,
          type: bestMatch.type,
          status: bestMatch.status,
          season: bestMatch.season,
          year: bestMatch.year,
          score: bestMatch.score,
          posterImage: bestMatch.poster,
          session: bestMatch.session
        }
      };
    } catch (error) {
      console.error('Error mapping AniList to AnimePahe:', error.message);
      throw new Error('Failed to map AniList to AnimePahe: ' + error.message);
    }
  }

  async findAnimePaheMatch(animeInfo) {
    let bestTitle = animeInfo.title.romaji || animeInfo.title.english || animeInfo.title.userPreferred;

    const searchResults = await this.animePahe.scrapeSearchResults(bestTitle);

    if (searchResults && searchResults.length > 0) {
      const rawId = animeInfo.id.toString();
      for (const result of searchResults) {
        const resultId = (result.id || '').split('-')[0];
        if (resultId && resultId === rawId) {
          return result;
        }
      }

      return this.findBestMatchFromResults(animeInfo, searchResults);
    }
    const genericTitle = this.getGenericTitle(animeInfo);

    if (genericTitle && genericTitle !== bestTitle) {
      const fallbackResults = await this.animePahe.scrapeSearchResults(genericTitle);

      if (fallbackResults && fallbackResults.length > 0) {
        return this.findBestMatchFromResults(animeInfo, fallbackResults);
      }
    }

    return null;
  }

  findBestMatchFromResults(animeInfo, results) {
    if (!results || results.length === 0) return null;
    const normalizeTitle = t => t.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
    const anilistTitles = [
      animeInfo.title.romaji,
      animeInfo.title.english,
      animeInfo.title.userPreferred
    ].filter(Boolean).map(normalizeTitle);

    const anilistYear =
      (animeInfo.startDate && animeInfo.startDate.year) ?
        animeInfo.startDate.year : animeInfo.seasonYear;

    const animeYear = anilistYear || this.extractYearFromTitle(animeInfo);

    let bestMatch = null;

    if (animeYear) {
      const yearMatches = [];
      for (const result of results) {
        const resultYear = result.year ? parseInt(result.year) : this.extractYearFromTitle(result);
        if (resultYear === animeYear) {
          yearMatches.push(result);
        }
      }

      if (yearMatches.length > 0) {
        for (const match of yearMatches) {
          const resultTitle = normalizeTitle(match.title || match.name);

          for (const title of anilistTitles) {
            if (!title) continue;

            if (resultTitle === title ||
              (resultTitle.includes(title) && title.length > 7) ||
              (title.includes(resultTitle) && resultTitle.length > 7)) {
              return match;
            }
          }

          for (const title of anilistTitles) {
            if (!title) continue;

            const similarity = this.calculateTitleSimilarity(title, resultTitle);
            if (similarity > 0.5) {
              bestMatch = match;
              break;
            }
          }

          if (bestMatch) break;
        }

        if (bestMatch) return bestMatch;

        return yearMatches[0];
      }
    }

    for (const result of results) {
      const resultTitle = normalizeTitle(result.title || result.name);

      for (const title of anilistTitles) {
        if (!title) continue;

        if (resultTitle === title) {
          return result;
        }
      }
    }

    bestMatch = this.findBestSimilarityMatch(anilistTitles, results);
    if (bestMatch) return bestMatch;

    return results[0];
  }

  findBestSimilarityMatch(titles, results) {
    const normalizeTitle = t => t.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
    let bestMatch = null;
    let highestSimilarity = 0;

    for (const result of results) {
      const resultTitle = normalizeTitle(result.title || result.name);

      for (const title of titles) {
        if (!title) continue;

        const similarity = this.calculateTitleSimilarity(title, resultTitle);
        if (similarity > highestSimilarity) {
          highestSimilarity = similarity;
          bestMatch = result;
        }
      }
    }

    return highestSimilarity > 0.6 ? bestMatch : null;
  }

  async getAnimePaheEpisodes(match) {
    try {
      const episodeData = await this.animePahe.scrapeEpisodes(match.id);
      return {
        totalEpisodes: episodeData.totalEpisodes || 0,
        episodes: episodeData.episodes || []
      };
    } catch (error) {
      console.error('Error getting AnimePahe episodes:', error.message);
      return { totalEpisodes: 0, episodes: [] };
    }
  }

  calculateTitleSimilarity(title1, title2) {
    if (!title1 || !title2) return 0;

    const norm1 = title1.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
    const norm2 = title2.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();

    if (norm1 === norm2) return 1;

    const words1 = norm1.split(' ').filter(Boolean);
    const words2 = norm2.split(' ').filter(Boolean);

    const commonCount = words1.filter(w => words2.includes(w)).length;

    return commonCount * 2 / (words1.length + words2.length);
  }

  extractYearFromTitle(item) {
    if (!item) return null;
    let titleStr = '';
    if (typeof item === 'string') {
      titleStr = item;
    } else if (typeof item === 'object') {
      if (item.title) {
        if (typeof item.title === 'string') {
          titleStr = item.title;
        } else if (typeof item.title === 'object') {
          titleStr = item.title.userPreferred || item.title.english || item.title.romaji || '';
        }
      } else if (item.name) {
        titleStr = item.name;
      }
    }

    if (!titleStr) return null;

    const yearMatches = titleStr.match(/[\(\[](\d{4})[\)\]]/);

    if (yearMatches && yearMatches[1]) {
      const year = parseInt(yearMatches[1]);
      if (!isNaN(year) && year > 1950 && year <= new Date().getFullYear()) {
        return year;
      }
    }

    return null;
  }

  getGenericTitle(animeInfo) {
    if (!animeInfo || !animeInfo.title) return null;

    const title = animeInfo.title.english || animeInfo.title.romaji || animeInfo.title.userPreferred;
    if (!title) return null;

    return title.replace(/\([^)]*\d{4}[^)]*\)/g, '').replace(/\[[^\]]*\d{4}[^\]]*\]/g, '').trim();
  }
}

export default mapAnilistToAnimePahe;
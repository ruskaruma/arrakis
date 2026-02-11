import passport from 'passport';
import { Strategy as GitHubStrategy } from 'passport-github2';

export interface GitHubUser {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
}

passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user: Express.User, done) => {
  done(null, user);
});

export function configureGitHub(): void {
  const clientID = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  const callbackURL = process.env.GITHUB_CALLBACK_URL || 'http://localhost:8080/auth/github/callback';

  if (!clientID || !clientSecret) {
    console.warn('GITHUB_CLIENT_ID or GITHUB_CLIENT_SECRET not set — OAuth disabled');
    return;
  }

  passport.use(new GitHubStrategy(
    { clientID, clientSecret, callbackURL },
    (_accessToken: string, _refreshToken: string, profile: any, done: any) => {
      const user: GitHubUser = {
        id: profile.id,
        username: profile.username,
        displayName: profile.displayName || profile.username,
        avatar: profile.photos?.[0]?.value || '',
      };
      done(null, user);
    }
  ));
}

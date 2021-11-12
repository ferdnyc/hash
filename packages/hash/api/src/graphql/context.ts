import { Logger } from "@hashintel/hash-backend-utils/logger";

import { PassportGraphQLMethods } from "../auth/passport";
import { User } from "../model";
import { DBAdapter } from "../db";
import { CacheAdapter } from "../cache";
import EmailTransporter from "../email/transporter";
import { StorageProviders, UploadableStorageProvider } from "../storage";

/**
 * Apollo context object with dataSources. For details see:
 * https://www.apollographql.com/docs/apollo-server/data/data-sources/
 */
export interface GraphQLContext {
  dataSources: {
    db: DBAdapter;
    cache: CacheAdapter;
  };
  emailTransporter: EmailTransporter;
  storageProviders: StorageProviders;
  uploadProvider: UploadableStorageProvider;
  passport: PassportGraphQLMethods;
  logger: Logger;
  user?: Omit<User, "entityType">;
}

export interface LoggedInGraphQLContext extends GraphQLContext {
  user: User;
}

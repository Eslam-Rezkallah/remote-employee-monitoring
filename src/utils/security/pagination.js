import * as dbService from "../../DB/db.service.js";

export const paginate = async ({
  page,
  size,
  model,
  populate = [],
  filter = {},
  select = "",
} = {}) => {
  page = parseInt(page < 1 ? process.env.PAGE : page);
  size = parseInt(size < 1 ? process.env.SIZE : size);
  const skip = (page - 1) * size;
  const count = await model.countDocuments(filter);
  const data = await dbService.find({
    model: model,
    filter,
    populate,
    select,
    skip,
    limit: size,
  });
  return { data, page, size, count };
};

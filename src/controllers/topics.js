const Topic = require('../models/topic')
const Promise = require('bluebird')
const { TopicsQuery } = require('../utils/queryHelpers')

module.exports.getTopics = async (req, res) => {
  const { query } = req
  let {
    curriculumId,
    supervisorId,
    q,
    sub,
    page,
    columnKey,
    order,
    types,
    curriculums
  } = query

  let extend = {}
  if (curriculumId) {
    extend = { curriculums: { $in: [curriculumId] } }
  }
  if (supervisorId) {
    extend = { 'supervisors.supervisor': { $in: [supervisorId] } }
  }

  // search
  if (q) {
    extend = {
      $or: [{ title: { $regex: q, $options: 'i' } }]
    }
  }

  page = page || 1
  const pageSize = 20
  const skip = page !== 1 ? (page - 1) * pageSize : 0

  const defaultOrder = 1 // ascend
  order = order ? (order === 'ascend' ? 1 : -1) : defaultOrder

  const defaultSort = 'title'
  let sortKey = columnKey || defaultSort
  let sort = {}
  sort[sortKey] = order

  // TYPES SE BA
  if (types && types.length > 0) extend.types = { $in: [query.types] }

  if (curriculums && curriculums.length > 0) { extend['curriculums.1'] = { $exists: true } }

  // Aggreaget for better search if needed
  // https://stackoverflow.com/questions/30341341/mongoose-query-full-name-with-regex
  const [topics, count] = await Promise.all([
    Topic.find(TopicsQuery(sub, extend))
      .populate('supervisors.supervisor', '_id profile')
      .populate('curriculums', '_id abbreviation slugs names type')
      .sort(sort)
      .skip(skip)
      .limit(pageSize),
    Topic.count(TopicsQuery(sub, extend))
  ])

  return res.json({ topics, count, query })
}

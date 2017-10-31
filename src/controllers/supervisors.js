const Topic = require('../models/topic')
const User = require('../models/user')
const moment = require('moment')
const mongoose = require('mongoose')

module.exports.getSupervisors = async (req, res) => {
  const { query } = req
  let { curriculumId, q, sub, page, columnKey, order } = query

  // TODO page, order, sort - move in separate service
  page = page || 1
  const pageSize = 20
  const skip = page !== 1 ? (page - 1) * pageSize : 0
  const endIndex = page > 1 ? page * pageSize : pageSize

  const defaultOrder = 1 // ascend
  order = order ? (order === 'ascend' ? 1 : -1) : defaultOrder

  const defaultSort = 'title'
  const sortKey = columnKey || defaultSort
  let sort = {}
  sort[sortKey] = order

  let extend = {}
  if (curriculumId) {
    extend = { curriculums: { $in: [mongoose.Types.ObjectId(curriculumId)] } }
  }

  // get previous school year
  const substract = moment()
    .subtract(8, 'months')
    .isBefore(moment().startOf('year'))
  const year = substract
    ? moment().startOf('year').subtract(1, 'year')
    : moment().startOf('year')
  const yearStart = year.clone().subtract(4, 'months').toDate()
  const yearEnd = year.clone().add(8, 'months').toDate()

  const subFilter = {}
  if (sub === 'supervised') {
    subFilter.defended = { $gt: 0 }
  }
  if (q) {
    subFilter.supervisor = { $regex: q, $options: 'i' }
  }

  const results = await Topic.aggregate([
    {
      $match: extend
    },
    { $unwind: '$supervisors' },
    { $unwind: '$supervisors.supervisor' },
    {
      $lookup: {
        from: 'users',
        localField: 'supervisors.supervisor',
        foreignField: '_id',
        as: 'supervisorData'
      }
    },
    { $unwind: '$supervisorData' },
    {
      $project: {
        _id: '$supervisors.supervisor',
        supervisor: {
          $concat: [
            '$supervisorData.profile.firstName',
            ' ',
            '$supervisorData.profile.lastName'
          ]
        },
        slug: '$supervisorData.profile.slug',
        defendedIsTrue: {
          $cond: {
            if: { $ifNull: ['$defended', false] },
            then: 1,
            else: 0
          }
        },
        defendedLastYear: {
          $cond: {
            if: {
              $and: [
                { $ifNull: ['$defended', false] },
                { $gte: ['$defended', yearStart] },
                { $lte: ['$defended', yearEnd] }
              ]
            },
            then: 1,
            else: 0
          }
        },
        registeredIsTrue: {
          $cond: {
            if: {
              $and: [
                { $ifNull: ['$registered', false] },
                { $eq: [{ $ifNull: ['$defended', null] }, null] }
              ]
            },
            then: 1,
            else: 0
          }
        },
        availableIsTrue: {
          $cond: {
            if: {
              $and: [
                { $ifNull: ['$accepted', false] },
                { $eq: [{ $ifNull: ['$registered', null] }, null] },
                { $eq: [{ $ifNull: ['$defended', null] }, null] }
              ]
            },
            then: 1,
            else: 0
          }
        }
      }
    },
    {
      $group: {
        _id: '$_id',
        // profile: { $first: '$data.profile' },
        supervisor: { $first: '$supervisor' },
        slug: { $first: '$slug' },
        defended: { $sum: '$defendedIsTrue' },
        defendedLastYear: { $sum: '$defendedLastYear' },
        registered: { $sum: '$registeredIsTrue' },
        available: { $sum: '$availableIsTrue' },
        all: { $sum: 1 }
      }
    },
    {
      $match: subFilter
    },
    { $sort: sort },
    { $project: { tmp: '$$ROOT' } },
    { $group: { _id: null, count: { $sum: 1 }, supervisors: { $push: '$tmp' } } },
    {
      $project: {
        count: 1,
        supervisors: { $slice: ['$supervisors', skip, endIndex] }
      }
    }
  ])

  const { supervisors, count } = results[0] || { supervisors: [], count: 0 }

  res.json({ supervisors, count, query })
}

module.exports.getSupervisorBySlug = async (req, res) => {
  // TODO validate req.params.slug
  const supervisor = await User
    .findOne({ 'profile.slug': req.params.slug })
    .select('_id profile')

  const topics = await Topic
    .find({ 'supervisors.supervisor': { $in: [supervisor._id] } })
    .select('_id accepted registered defended types')
    .sort({ defended: 1 })

  const counts = {
    available: 0,
    registered: { all: 0, types: {} },
    defended: { all: 0, types: {} }
  }

  let chartData = {}

  topics.forEach(t => {
    const accepted = t.accepted && !t.registered && !t.defended
    const registered = t.registered && !t.defended
    const defended = t.defended

    const type = t.types[0]

    if (accepted) { counts.available++ }
    if (registered) {
      if (!counts.registered.types[type]) counts.registered.types[type] = 0

      counts.registered.all++
      counts.registered.types[type]++
    }

    if (defended) {
      if (!counts.defended.types[type]) counts.defended.types[type] = 0

      counts.defended.all++
      counts.defended.types[type]++

      const defMoment = moment(defended)
      const sameYear = defMoment
        .isSame(defMoment.clone().subtract(9, 'months'), 'year')

      const schoolyear = sameYear
        ? defMoment.format('YY') +
          '/' +
          defMoment.clone().add(1, 'year').format('YY')
        : defMoment.clone().subtract(1, 'year').format('YY') +
          '/' +
          defMoment.format('YY')

      if (!chartData[schoolyear]) {
        chartData[schoolyear] = { all: 0, types: {} }
      }
      chartData[schoolyear].all++

      if (!chartData[schoolyear].types[type]) {
        chartData[schoolyear].types[type] = 0
      }
      chartData[schoolyear].types[type]++
    }
  })

  // transform chartData to array
  counts.defended.chartData = Object.keys(chartData).map(key => {
    return { name: key, counts: chartData[key] }
  })

  counts.all = topics.length

  return res.json({ supervisor, counts })
}
